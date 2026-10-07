/**
 * getRepoLifecycle for Agent HQ requests (roadmap Phase 81): the agent_requests row decides the
 * stage (no 15-minute timeout: the factory may take hours to pick a request up), PR outcomes come
 * from portfolio_events, and older Nexus tasks are still projected from their events.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Event = { eventType: string; metadata: Record<string, unknown> | null; occurredAt: Date }
let events: Event[] = []
let row: { status: string; prUrl: string | null; reason: string | null } | undefined
let eventsFail = false

vi.mock('@/lib/db', () => ({
  db: {
    query: {
      portfolioEvents: { findMany: async () => { if (eventsFail) throw new Error('neon down'); return events } },
      agentRequests: { findFirst: async () => row },
    },
  },
}))

const { getRepoLifecycle } = await import('@/lib/agents/lifecycle')
const { LIFECYCLE_TIMEOUT_MS } = await import('@/lib/agents/lifecycle-utils')

const HOUR = 3_600_000
const ago = (ms: number) => new Date(Date.now() - ms)
const queued = (taskId: string, executor: string | null, at = ago(HOUR)): Event =>
  ({ eventType: 'agent_task_queued', metadata: { taskId, ...(executor ? { executor } : {}) }, occurredAt: at })
const event = (eventType: string, taskId: string, extra: Record<string, unknown> = {}): Event =>
  ({ eventType, metadata: { taskId, ...extra }, occurredAt: ago(1_000) })

beforeEach(() => {
  events = []
  row = undefined
  eventsFail = false
})

describe('factory requests: the row decides', () => {
  it.each([
    ['queued', 'queued'], ['running', 'running'], ['verified', 'verified'], ['reported', 'report_ready'],
    ['rejected', 'failed'], ['failed', 'failed'], ['cancelled', 'idle'],
  ])('%s → %s', async (status, stage) => {
    events = [queued('t1', 'factory')]
    row = { status, prUrl: null, reason: status === 'queued' ? 'waiting for AC power' : null }
    expect(await getRepoLifecycle('u', 1)).toMatchObject({ stage, taskId: 't1', reason: row.reason })
  })

  it('never times out while queued, even a day later', async () => {
    events = [queued('t1', 'factory', ago(24 * HOUR))]
    row = { status: 'queued', prUrl: null, reason: null }
    expect((await getRepoLifecycle('u', 1)).stage).toBe('queued')
  })

  it('a PR is pr_ready until the merge checker or CI checker says more', async () => {
    events = [queued('t1', 'factory')]
    row = { status: 'pr', prUrl: 'https://github.com/o/r/pull/1', reason: null }
    expect(await getRepoLifecycle('u', 1)).toMatchObject({ stage: 'pr_ready', prUrl: 'https://github.com/o/r/pull/1' })

    events = [event('agent_ci_failed', 't1', { prUrl: 'https://github.com/o/r/pull/1' }), queued('t1', 'factory')]
    expect((await getRepoLifecycle('u', 1)).stage).toBe('ci_failing')
    events = [event('agent_needs_human', 't1'), event('agent_ci_failed', 't1'), queued('t1', 'factory')]
    expect((await getRepoLifecycle('u', 1)).stage).toBe('needs_human')
    events = [event('agent_pr_merged', 't1', { prUrl: 'https://github.com/o/r/pull/1' }), queued('t1', 'factory')]
    expect(await getRepoLifecycle('u', 1)).toMatchObject({ stage: 'merged', prUrl: 'https://github.com/o/r/pull/1' })
    events = [event('agent_pr_rejected', 't1'), queued('t1', 'factory')]
    expect((await getRepoLifecycle('u', 1)).stage).toBe('rejected')
  })

  it('only the latest task counts, and other tasks\' events are ignored', async () => {
    events = [queued('t2', 'factory'), event('agent_pr_merged', 't1'), queued('t1', 'factory', ago(5 * HOUR))]
    row = { status: 'running', prUrl: null, reason: null }
    expect(await getRepoLifecycle('u', 1)).toMatchObject({ stage: 'running', taskId: 't2' })
  })
})

describe('older Nexus tasks: projected from events', () => {
  it('times out after the legacy window', async () => {
    events = [queued('n1', null, ago(LIFECYCLE_TIMEOUT_MS + 60_000))]
    expect((await getRepoLifecycle('u', 1)).stage).toBe('timed_out')
    events = [queued('n1', null, ago(60_000))]
    expect((await getRepoLifecycle('u', 1)).stage).toBe('queued')
  })

  it('PR, report and failure events', async () => {
    events = [event('agent_pr_created', 'n1', { prUrl: 'https://github.com/o/r/pull/9' }), queued('n1', null)]
    expect(await getRepoLifecycle('u', 1)).toMatchObject({ stage: 'pr_ready', prUrl: 'https://github.com/o/r/pull/9' })
    events = [event('agent_skill_report', 'n1'), queued('n1', null)]
    expect((await getRepoLifecycle('u', 1)).stage).toBe('report_ready')
    events = [event('agent_execution_failed', 'n1'), queued('n1', null)]
    expect((await getRepoLifecycle('u', 1)).stage).toBe('failed')
  })

  it('a factory task whose row is gone falls back to its events', async () => {
    events = [event('agent_skill_report', 't1'), queued('t1', 'factory')]
    row = undefined
    expect((await getRepoLifecycle('u', 1)).stage).toBe('report_ready')
  })
})

describe('idle', () => {
  it('without events, without a queued event, without a task id, or when Neon fails', async () => {
    expect((await getRepoLifecycle('u', 1)).stage).toBe('idle')
    events = [event('agent_pr_merged', 't1')]
    expect((await getRepoLifecycle('u', 1)).stage).toBe('idle')
    events = [{ eventType: 'agent_task_queued', metadata: {}, occurredAt: ago(1_000) }]
    expect((await getRepoLifecycle('u', 1)).stage).toBe('idle')
    eventsFail = true
    expect((await getRepoLifecycle('u', 1)).stage).toBe('idle')
  })
})
