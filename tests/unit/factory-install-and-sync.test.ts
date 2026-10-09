import { describe, expect, it } from 'vitest'
import { installCommand, withoutScripts } from '../../factory/lib/checks'
import { rankOpportunities } from '../../factory/lib/sensors'
import { systemHealthLines } from '../../factory/lib/system-health'
import { syncFailure } from '../../src/lib/health/sync-health'
import type { LedgerEntry, SignalsEntry } from '../../factory/lib/ledger'

const NOW = new Date('2026-10-09T13:00:00Z')

describe('install without scripts', () => {
  it('adds --ignore-scripts to the same install', () => {
    expect(withoutScripts(installCommand('npm', new Set(['package-lock.json'])))).toEqual({ cmd: 'npm', args: ['ci', '--no-audit', '--no-fund', '--ignore-scripts'] })
    expect(withoutScripts(installCommand('pnpm', new Set()))).toEqual({ cmd: 'pnpm', args: ['install', '--frozen-lockfile', '--ignore-scripts'] })
  })
})

describe('a repo whose install failed sits out for a day', () => {
  const sig = (repo: string, critical: number): SignalsEntry => ({
    type: 'signals', runId: 'r', at: NOW.toISOString(), repo, base: 'main', redCi: [],
    alerts: { status: 'ok', critical, high: 0, medium: 0, low: 0, npmFixable: critical }, botPrs: { open: 0, stale: [] },
  })
  const failedScan = (at: string): LedgerEntry => ({ type: 'scan', runId: 'r', at, repo: 'o/broken', checks: { install: false }, tasks: [] })
  it('drops below repos with work it can do, then comes back after 24 h', () => {
    const signals = [sig('o/broken', 5), sig('o/fine', 1)]
    expect(rankOpportunities(['o/broken', 'o/fine'], [failedScan('2026-10-09T10:00:00Z')], signals, NOW)[0].repo).toBe('o/fine')
    expect(rankOpportunities(['o/broken', 'o/fine'], [failedScan('2026-10-08T10:00:00Z')], signals, NOW)[0].repo).toBe('o/broken')
  })
})

describe('sync failure check', () => {
  const run = (status: string, startedAt: string, error: string | null = null) => ({ status, startedAt, error })
  it('counts consecutive failed syncs back from the newest finished one', () => {
    const f = syncFailure([run('running', '2026-10-09T12:00:00Z'), run('failed', '2026-10-09T06:00:00Z', 'Bad credentials'), run('failed', '2026-10-09T00:00:00Z', 'Bad credentials'), run('complete', '2026-10-08T18:00:00Z')])
    expect(f).toMatchObject({ failures: 2, since: '2026-10-09T00:00:00Z', error: 'Bad credentials' })
    expect(f!.hint).toMatch(/sign out of RepoHQ and sign back in/)
    expect(syncFailure([run('complete', '2026-10-09T06:00:00Z'), run('failed', '2026-10-09T00:00:00Z')])).toBeNull()
  })
  it('raises the alarm in the morning report', () => {
    const h = systemHealthLines({ disabledWorkflows: [], latestSnapshot: '2026-10-09', requests: null, syncs: [run('failed', '2026-10-09T06:00:00Z', 'Bad credentials - https://docs.github.com/rest')] }, NOW)
    expect(h.alarm).toBe(true)
    expect(h.lines.some(l => /⚠ RepoHQ sync: the last sync failed .*sign back in/.test(l))).toBe(true)
  })
})

describe('preflight', () => {
  it('summarises checks on one line and alarms only on hard failures', async () => {
    const { preflightLines } = await import('../../factory/lib/preflight')
    expect(preflightLines([{ name: 'Docker', ok: true, detail: '' }, { name: 'disk', ok: true, detail: '162 GB free' }])).toEqual({ lines: ['Preflight: Docker ✓ · disk ✓ (162 GB free).'], alarm: false })
    const soft = preflightLines([{ name: 'swap', ok: false, detail: '7.9 of 9.0 GB', fix: 'lower Docker memory', soft: true }])
    expect(soft.alarm).toBe(false)
    expect(soft.lines[1]).toBe('⚠ swap: 7.9 of 9.0 GB — lower Docker memory.')
    expect(preflightLines([{ name: 'Docker', ok: false, detail: 'not running' }]).alarm).toBe(true)
  })
  it('finds allowlisted repos the GitHub App cannot reach, and parses swap', async () => {
    const { missingFromApp, swapUsage } = await import('../../factory/lib/preflight')
    expect(missingFromApp(['o/a', 'o/B'], ['o/b'])).toEqual(['o/a'])
    expect(swapUsage('vm.swapusage: total = 9216.00M  used = 8052.12M  free = 1163.88M  (encrypted)')).toEqual({ usedMb: 8052.12, totalMb: 9216 })
  })
  it('sweeps work folders older than two days', async () => {
    const { sweepWorkDirs } = await import('../../factory/lib/preflight')
    const { mkdtempSync, mkdirSync, utimesSync, existsSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const path = await import('node:path')
    const home = mkdtempSync(path.join(tmpdir(), 'factory-home-'))
    mkdirSync(path.join(home, 'work', 'old'), { recursive: true })
    mkdirSync(path.join(home, 'work', 'new'), { recursive: true })
    const threeDaysAgo = new Date(Date.now() - 3 * 86_400_000)
    utimesSync(path.join(home, 'work', 'old'), threeDaysAgo, threeDaysAgo)
    expect(sweepWorkDirs(home, new Date())).toBe(1)
    expect(existsSync(path.join(home, 'work', 'new'))).toBe(true)
  })
})
