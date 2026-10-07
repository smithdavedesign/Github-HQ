import { describe, expect, it } from 'vitest'
import { RESTART_LOOP_STARTS, WORKER_FRESH_MS, workerState, type WorkerStatus } from '../../factory/lib/worker-state'
import { EXIT_AFTER_FAILURES, STUCK_PICKUP_MS, configProblem, heartbeatAction, pickupCheck, recentStarts } from '../../factory/lib/worker-health'

const NOW = Date.parse('2026-10-07T04:00:00Z')
const ago = (ms: number) => new Date(NOW - ms).toISOString()
const status = (over: Partial<WorkerStatus> = {}): WorkerStatus => ({
  host: 'mac', pid: 1, startedAt: ago(60 * 60_000), lastSeenAt: ago(20_000), pausedFile: false, onAc: true,
  dockerUp: true, version: 'abc1234', activeJob: null, problem: null, stoppedAt: null, stopReason: null,
  starts: [ago(60 * 60_000)], ...over,
})

describe('workerState: off and not working are different things', () => {
  it('online with a fresh status and nothing wrong', () => {
    expect(workerState(status(), NOW)).toEqual({ kind: 'online' })
  })

  it('off, not broken, when the status went quiet (asleep, shut down, offline)', () => {
    expect(workerState(status({ lastSeenAt: ago(WORKER_FRESH_MS + 1) }), NOW)).toEqual({ kind: 'off', lastSeenAt: ago(WORKER_FRESH_MS + 1), stopped: null })
  })

  it('off with the reason when it stopped cleanly, even if the record is fresh', () => {
    expect(workerState(status({ stoppedAt: ago(5_000), stopReason: 'SIGTERM' }), NOW)).toEqual({ kind: 'off', lastSeenAt: ago(5_000), stopped: 'SIGTERM' })
  })

  it('not set up when there has never been a status', () => {
    expect(workerState(null, NOW)).toEqual({ kind: 'not-set-up' })
  })

  it('not working when the running worker reports a problem', () => {
    expect(workerState(status({ problem: 'requests can\'t run: FACTORY_USER_ID isn\'t set' }), NOW)).toEqual({ kind: 'not-working', reason: 'requests can\'t run: FACTORY_USER_ID isn\'t set' })
  })

  it('not working while Docker is down (cycles and requests wait for it)', () => {
    expect(workerState(status({ dockerUp: false }), NOW)).toMatchObject({ kind: 'not-working', reason: expect.stringMatching(/Docker/) })
  })

  it(`not working when launchd restarted it ${RESTART_LOOP_STARTS}+ times in 15 minutes, even once the status is stale`, () => {
    const looping = { starts: [ago(12 * 60_000), ago(8 * 60_000), ago(4 * 60_000)] }
    expect(workerState(status(looping), NOW)).toMatchObject({ kind: 'not-working', reason: expect.stringMatching(/keeps restarting \(3 starts in 15 min\)/) })
    expect(workerState(status({ ...looping, lastSeenAt: ago(4 * 60_000) }), NOW)).toMatchObject({ kind: 'not-working' })
    // Two starts (one restart) is normal, and old starts don't count.
    expect(workerState(status({ starts: [ago(30 * 60_000), ago(20 * 60_000), ago(10 * 60_000)] }), NOW)).toEqual({ kind: 'online' })
  })

  it('reads records written before these fields existed', () => {
    const { problem: _p, stoppedAt: _s, stopReason: _r, starts: _st, ...old } = status()
    expect(workerState(old, NOW)).toEqual({ kind: 'online' })
  })
})

describe('worker self-check', () => {
  it('a failed heartbeat reconnects; an idle worker restarts after repeated failures', () => {
    expect(heartbeatAction(1, false)).toBe('reconnect')
    expect(heartbeatAction(EXIT_AFTER_FAILURES - 1, false)).toBe('reconnect')
    expect(heartbeatAction(EXIT_AFTER_FAILURES, false)).toBe('exit')
  })

  it('never restarts a worker that is running a job', () => {
    expect(heartbeatAction(EXIT_AFTER_FAILURES * 3, true)).toBe('reconnect')
  })

  it('jobs waiting past the limit with nothing running mean pickup is stuck', () => {
    const first = pickupCheck({ waiting: 2, active: 0 }, null, NOW)
    expect(first).toEqual({ waitingSince: NOW, stuck: false })
    expect(pickupCheck({ waiting: 2, active: 0 }, first.waitingSince, NOW + STUCK_PICKUP_MS - 1).stuck).toBe(false)
    expect(pickupCheck({ waiting: 2, active: 0 }, first.waitingSince, NOW + STUCK_PICKUP_MS + 1).stuck).toBe(true)
  })

  it('an empty queue or a running job resets the wait', () => {
    expect(pickupCheck({ waiting: 0, active: 0 }, NOW - STUCK_PICKUP_MS * 2, NOW)).toEqual({ waitingSince: null, stuck: false })
    expect(pickupCheck({ waiting: 3, active: 1 }, NOW - STUCK_PICKUP_MS * 2, NOW)).toEqual({ waitingSince: null, stuck: false })
  })

  it('keeps the last hour of starts, at most 10, newest last', () => {
    const now = new Date(NOW)
    expect(recentStarts(undefined, now)).toEqual([now.toISOString()])
    expect(recentStarts([ago(2 * 60 * 60_000), ago(30 * 60_000)], now)).toEqual([ago(30 * 60_000), now.toISOString()])
    expect(recentStarts(Array.from({ length: 12 }, (_, i) => ago((i + 1) * 60_000)), now)).toHaveLength(10)
  })

  it('says what is missing when requests can\'t run', () => {
    expect(configProblem({ userId: 'u', databaseUrl: 'postgres://x' })).toBeNull()
    expect(configProblem({ userId: null, databaseUrl: 'postgres://x' })).toMatch(/FACTORY_USER_ID isn't set in ~\/\.repohq-factory\/env/)
    expect(configProblem({ userId: 'u', databaseUrl: null })).toMatch(/database URL/)
  })
})
