/**
 * Phase 50 — Active work signal unit tests.
 *
 * Tests the pure logic for detecting open agent PRs and dead-end actions
 * without requiring a live DB. We exercise the algorithms directly.
 */
import { describe, it, expect } from 'vitest'

// ─── Open PR detection logic ──────────────────────────────────────────────────

interface AgentEvent {
  repoId: number | null
  eventType: string
  metadata: Record<string, unknown> | null
  occurredAt: Date
}

/** Mirror of the getOpenAgentPRMap logic for unit testing */
function computeOpenPRMap(events: AgentEvent[]): Map<number, { prUrl: string; taskId: string }> {
  const mergedTaskIds = new Set<string>()
  for (const e of events) {
    if (e.eventType === 'agent_pr_merged') {
      const taskId = e.metadata?.taskId as string | undefined
      if (taskId) mergedTaskIds.add(taskId)
    }
  }

  const result = new Map<number, { prUrl: string; taskId: string }>()
  for (const e of events) {
    if (e.eventType === 'agent_pr_created' && e.repoId != null) {
      const taskId = e.metadata?.taskId as string | undefined
      const prUrl = e.metadata?.prUrl as string | undefined
      if (taskId && !mergedTaskIds.has(taskId) && !result.has(e.repoId)) {
        result.set(e.repoId, { prUrl: prUrl ?? '', taskId })
      }
    }
  }
  return result
}

describe('computeOpenPRMap', () => {
  const now = new Date()

  it('returns empty map when no events', () => {
    expect(computeOpenPRMap([])).toEqual(new Map())
  })

  it('marks PR as open when only agent_pr_created exists', () => {
    const events: AgentEvent[] = [
      { repoId: 1, eventType: 'agent_pr_created', metadata: { taskId: 'task-1', prUrl: 'https://github.com/test/repo/pull/1' }, occurredAt: now },
    ]
    const map = computeOpenPRMap(events)
    expect(map.has(1)).toBe(true)
    expect(map.get(1)?.taskId).toBe('task-1')
    expect(map.get(1)?.prUrl).toBe('https://github.com/test/repo/pull/1')
  })

  it('does NOT mark PR as open when agent_pr_merged exists for same taskId', () => {
    const events: AgentEvent[] = [
      { repoId: 1, eventType: 'agent_pr_created', metadata: { taskId: 'task-1', prUrl: 'https://github.com/test/repo/pull/1' }, occurredAt: now },
      { repoId: 1, eventType: 'agent_pr_merged',  metadata: { taskId: 'task-1' }, occurredAt: now },
    ]
    expect(computeOpenPRMap(events).has(1)).toBe(false)
  })

  it('handles multiple repos independently', () => {
    const events: AgentEvent[] = [
      { repoId: 1, eventType: 'agent_pr_created', metadata: { taskId: 'task-1', prUrl: 'https://github.com/test/r1/pull/1' }, occurredAt: now },
      { repoId: 2, eventType: 'agent_pr_created', metadata: { taskId: 'task-2', prUrl: 'https://github.com/test/r2/pull/2' }, occurredAt: now },
      { repoId: 1, eventType: 'agent_pr_merged',  metadata: { taskId: 'task-1' }, occurredAt: now },
    ]
    const map = computeOpenPRMap(events)
    expect(map.has(1)).toBe(false)  // merged
    expect(map.has(2)).toBe(true)   // still open
  })

  it('only returns the first open PR per repo (most recent queued)', () => {
    const events: AgentEvent[] = [
      { repoId: 1, eventType: 'agent_pr_created', metadata: { taskId: 'task-1', prUrl: 'https://github.com/test/r1/pull/1' }, occurredAt: now },
      { repoId: 1, eventType: 'agent_pr_created', metadata: { taskId: 'task-2', prUrl: 'https://github.com/test/r1/pull/2' }, occurredAt: new Date(now.getTime() - 1000) },
    ]
    const map = computeOpenPRMap(events)
    expect(map.size).toBe(1)
    expect(map.get(1)?.taskId).toBe('task-1')
  })
})

// ─── Dead-end action detection ────────────────────────────────────────────────

interface AttemptEvent {
  repoId: number | null
  metadata: { action?: string; outcome?: string } | null
}

function computeDeadEnds(attempts: AttemptEvent[]): Set<string> {
  const failCounts = new Map<string, number>()
  for (const a of attempts) {
    if (a.metadata?.outcome === 'failed' && a.repoId != null && a.metadata.action) {
      const key = `${a.repoId}::${a.metadata.action.toLowerCase().slice(0, 60)}`
      failCounts.set(key, (failCounts.get(key) ?? 0) + 1)
    }
  }
  const deadEnds = new Set<string>()
  for (const [key, count] of failCounts) {
    if (count >= 2) deadEnds.add(key)
  }
  return deadEnds
}

describe('computeDeadEnds', () => {
  it('returns empty set when no attempts', () => {
    expect(computeDeadEnds([])).toEqual(new Set())
  })

  it('does not flag an action with only 1 failure', () => {
    const attempts: AttemptEvent[] = [
      { repoId: 1, metadata: { action: 'add tests', outcome: 'failed' } },
    ]
    expect(computeDeadEnds(attempts).size).toBe(0)
  })

  it('flags an action with 2 failures as a dead end', () => {
    const attempts: AttemptEvent[] = [
      { repoId: 1, metadata: { action: 'add tests', outcome: 'failed' } },
      { repoId: 1, metadata: { action: 'add tests', outcome: 'failed' } },
    ]
    const deadEnds = computeDeadEnds(attempts)
    expect(deadEnds.has('1::add tests')).toBe(true)
  })

  it('does not flag successful attempts', () => {
    const attempts: AttemptEvent[] = [
      { repoId: 1, metadata: { action: 'add tests', outcome: 'success' } },
      { repoId: 1, metadata: { action: 'add tests', outcome: 'success' } },
    ]
    expect(computeDeadEnds(attempts).size).toBe(0)
  })

  it('treats failures on different repos independently', () => {
    const attempts: AttemptEvent[] = [
      { repoId: 1, metadata: { action: 'add tests', outcome: 'failed' } },
      { repoId: 2, metadata: { action: 'add tests', outcome: 'failed' } },
    ]
    // neither repo has 2 failures for this action
    expect(computeDeadEnds(attempts).size).toBe(0)
  })

  it('is case-insensitive for action matching', () => {
    const attempts: AttemptEvent[] = [
      { repoId: 1, metadata: { action: 'Add Tests', outcome: 'failed' } },
      { repoId: 1, metadata: { action: 'add tests', outcome: 'failed' } },
    ]
    const deadEnds = computeDeadEnds(attempts)
    expect(deadEnds.has('1::add tests')).toBe(true)
  })
})
