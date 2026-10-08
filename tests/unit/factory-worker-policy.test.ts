/**
 * Agent HQ worker decisions (roadmap Phase 81, docs/agent-hq-migration-prd.md §6): which jobs may
 * start, what happens to a request after its run, and the commands jobs run.
 */
import { describe, expect, it } from 'vitest'
import {
  JOB_TIMEOUT_MS, MAX_REQUEST_ATTEMPTS, childCommand, gateFor, needsRequeue, requestFollowUp, runStatusFor, type HostState,
} from '../../factory/lib/worker-policy'
import { lockHolder } from '../../factory/lib/lock'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const host = (over: Partial<HostState> = {}): HostState => ({ pausedFile: false, onAc: true, requireAc: true, lockHolder: null, dockerUp: true, ...over })

describe('gateFor', () => {
  it('runs everything on a healthy, plugged-in Mac', () => {
    for (const j of ['cycle', 'request', 'report', 'scout'] as const) expect(gateFor(j, host())).toEqual({ action: 'run' })
  })

  it('PAUSE and a held lock make requests and Run now wait (the queue keeps its jobs)', () => {
    for (const j of ['cycle', 'request', 'report', 'scout'] as const) {
      expect(gateFor(j, host({ pausedFile: true }))).toMatchObject({ action: 'wait', reason: expect.stringMatching(/PAUSE/) })
      expect(gateFor(j, host({ lockHolder: 'run x, pid 9' }))).toMatchObject({ action: 'wait', delayMs: 5 * 60_000 })
    }
  })

  it('PAUSE skips scheduled jobs instead of letting every missed slot pile up for the resume', () => {
    for (const j of ['cycle', 'report', 'scout'] as const) {
      expect(gateFor(j, host({ pausedFile: true }), true)).toMatchObject({ action: 'skip', reason: expect.stringMatching(/PAUSE/) })
    }
  })

  it('a held lock skips a scheduled cycle; the report and scout just wait for it', () => {
    expect(gateFor('cycle', host({ lockHolder: 'run x, pid 9' }), true)).toMatchObject({ action: 'skip', reason: expect.stringMatching(/another factory process/) })
    expect(gateFor('report', host({ lockHolder: 'run x, pid 9' }), true)).toMatchObject({ action: 'wait', delayMs: 5 * 60_000 })
    expect(gateFor('scout', host({ lockHolder: 'run x, pid 9' }), true)).toMatchObject({ action: 'wait' })
  })

  it('on battery: scheduled cycles skip (Night Shift v2), requests wait, report/scout still run', () => {
    const b = host({ onAc: false })
    expect(gateFor('cycle', b)).toMatchObject({ action: 'skip', reason: expect.stringMatching(/battery/) })
    expect(gateFor('request', b)).toMatchObject({ action: 'wait', reason: 'waiting for AC power' })
    expect(gateFor('report', b)).toEqual({ action: 'run' })
    expect(gateFor('scout', b)).toEqual({ action: 'run' })
    // FACTORY_REQUIRE_AC=0 and unknown power (not macOS) both run.
    expect(gateFor('cycle', host({ onAc: false, requireAc: false }))).toEqual({ action: 'run' })
    expect(gateFor('cycle', host({ onAc: null }))).toEqual({ action: 'run' })
  })

  it('Docker down: cycles skip, requests wait; never a fallback to the host', () => {
    expect(gateFor('cycle', host({ dockerUp: false }))).toMatchObject({ action: 'skip', reason: expect.stringMatching(/Docker/) })
    expect(gateFor('request', host({ dockerUp: false }))).toMatchObject({ action: 'wait', reason: expect.stringMatching(/Docker/) })
    expect(gateFor('cycle', host({ dockerUp: null }))).toEqual({ action: 'run' }) // sandbox off: not checked
  })
})

describe('requestFollowUp', () => {
  it('a resolved request is done whatever the run said', () => {
    for (const s of ['pr', 'verified', 'reported', 'rejected', 'failed', 'cancelled']) {
      expect(requestFollowUp({ status: 'failed' }, s, 0)).toEqual({ action: 'done' })
    }
  })

  it('deferred/skipped runs wait without counting as failures', () => {
    expect(requestFollowUp({ status: 'deferred', reason: 'quota', retryInMinutes: 60 }, 'running', 1))
      .toEqual({ action: 'defer', reason: 'quota', delayMs: 60 * 60_000, failures: 1 })
    expect(requestFollowUp({ status: 'skipped', reason: 'refused' }, 'running', 0)).toMatchObject({ action: 'defer', delayMs: 15 * 60_000, failures: 0 })
  })

  it('failures retry until MAX_REQUEST_ATTEMPTS, then fail with the reason', () => {
    const first = requestFollowUp({ status: 'failed', reason: 'clone failed' }, 'running', 0)
    expect(first).toMatchObject({ action: 'defer', failures: 1, reason: expect.stringMatching(/clone failed — retrying \(1\/3\)/) })
    expect(requestFollowUp({ status: 'failed', reason: 'clone failed' }, 'running', MAX_REQUEST_ATTEMPTS - 1))
      .toEqual({ action: 'fail', reason: `clone failed (after ${MAX_REQUEST_ATTEMPTS} attempts)` })
    // An "ok" run that left the request open is a failure to resolve it.
    expect(requestFollowUp({ status: 'ok' }, 'running', 0)).toMatchObject({ action: 'defer', reason: expect.stringMatching(/without an outcome/) })
  })
})

describe('jobs → commands and records', () => {
  it('runs the same entry points factory.sh used, under caffeinate on macOS only', () => {
    expect(childCommand('cycle', { platform: 'darwin' })).toEqual({ cmd: 'caffeinate', args: ['-ims', 'npx', '--no-install', 'tsx', 'factory/run.ts', '--scheduled'] })
    expect(childCommand('request', { platform: 'linux', requestId: 'r1' })).toEqual({ cmd: 'npx', args: ['--no-install', 'tsx', 'factory/run.ts', '--scheduled', '--request=r1'] })
    expect(childCommand('report', { platform: 'linux' }).args).toContain('factory/report.ts')
    expect(childCommand('scout', { platform: 'linux' }).args).toContain('factory/scout.ts')
  })

  it('FACTORY_WORKER_CHILD swaps the entry point (flow tests), keeping the arguments and caffeinate', () => {
    expect(childCommand('request', { platform: 'linux', requestId: 'r1', script: 'tests/flow/fixtures/fake-run.ts' })).toEqual({
      cmd: 'npx', args: ['--no-install', 'tsx', 'tests/flow/fixtures/fake-run.ts', 'request', '--scheduled', '--request=r1'],
    })
    expect(childCommand('report', { platform: 'darwin', script: 'fake.ts' })).toEqual({ cmd: 'caffeinate', args: ['-ims', 'npx', '--no-install', 'tsx', 'fake.ts', 'report'] })
    // Unset (or empty, as the worker passes it): the real entry points.
    expect(childCommand('cycle', { platform: 'linux', script: undefined }).args).toEqual(['--no-install', 'tsx', 'factory/run.ts', '--scheduled'])
  })

  it('a deferral did no work: its run is "skipped"', () => {
    expect(runStatusFor({ status: 'deferred' })).toBe('skipped')
    expect(runStatusFor({ status: 'ok' })).toBe('ok')
    expect(runStatusFor({ status: 'failed' })).toBe('failed')
  })

  it('every kind has a hard timeout above the sandbox lifetime', () => {
    for (const ms of Object.values(JOB_TIMEOUT_MS)) expect(ms).toBeGreaterThanOrEqual(30 * 60_000)
    expect(JOB_TIMEOUT_MS.cycle).toBeGreaterThan(90 * 60_000)
  })

  it('reconcile re-adds missing or finished jobs of open requests only', () => {
    expect(needsRequeue(null)).toBe(true)
    expect(needsRequeue('completed')).toBe(true)
    expect(needsRequeue('failed')).toBe(true)
    for (const s of ['waiting', 'delayed', 'active', 'prioritized', 'waiting-children']) expect(needsRequeue(s)).toBe(false)
  })
})

describe('lockHolder', () => {
  it('reports a live holder and ignores stale or missing locks', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'factory-lock-'))
    expect(lockHolder(home)).toBeNull()
    writeFileSync(path.join(home, 'factory.lock'), JSON.stringify({ pid: process.pid, owner: 'run test', at: 'now' }))
    expect(lockHolder(home)).toBe(`run test, pid ${process.pid}`)
    writeFileSync(path.join(home, 'factory.lock'), JSON.stringify({ pid: 2 ** 22 + 12345, owner: 'run old', at: 'then' }))
    expect(lockHolder(home)).toBeNull()
  })
})
