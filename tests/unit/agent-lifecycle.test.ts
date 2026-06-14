/**
 * Agent lifecycle unit tests — pure logic only, no DB.
 * Tests the stage derivation rules used by getRepoLifecycle().
 */
import { describe, it, expect } from 'vitest'
import { BLOCKING_STAGES, TERMINAL_STAGES } from '../../src/lib/agents/lifecycle-utils'

// ─── Stage classification ─────────────────────────────────────────────────────

describe('BLOCKING_STAGES', () => {
  it('contains all non-terminal in-progress stages', () => {
    expect(BLOCKING_STAGES.has('queued')).toBe(true)
    expect(BLOCKING_STAGES.has('preparing')).toBe(true)
    expect(BLOCKING_STAGES.has('running')).toBe(true)
    expect(BLOCKING_STAGES.has('pr_ready')).toBe(true)
  })

  it('does NOT include terminal stages', () => {
    expect(BLOCKING_STAGES.has('idle')).toBe(false)
    expect(BLOCKING_STAGES.has('merged')).toBe(false)
    expect(BLOCKING_STAGES.has('rejected')).toBe(false)
    expect(BLOCKING_STAGES.has('failed')).toBe(false)
    expect(BLOCKING_STAGES.has('timed_out')).toBe(false)
  })
})

describe('TERMINAL_STAGES', () => {
  it('includes idle and all completion states', () => {
    expect(TERMINAL_STAGES.has('idle')).toBe(true)
    expect(TERMINAL_STAGES.has('merged')).toBe(true)
    expect(TERMINAL_STAGES.has('rejected')).toBe(true)
    expect(TERMINAL_STAGES.has('failed')).toBe(true)
    expect(TERMINAL_STAGES.has('timed_out')).toBe(true)
  })

  it('does NOT include in-progress stages', () => {
    expect(TERMINAL_STAGES.has('queued')).toBe(false)
    expect(TERMINAL_STAGES.has('running')).toBe(false)
    expect(TERMINAL_STAGES.has('pr_ready')).toBe(false)
  })

  it('blocking and terminal are mutually exclusive', () => {
    for (const stage of BLOCKING_STAGES) {
      expect(TERMINAL_STAGES.has(stage)).toBe(false)
    }
    for (const stage of TERMINAL_STAGES) {
      expect(BLOCKING_STAGES.has(stage)).toBe(false)
    }
  })
})

// ─── Lifecycle derivation logic (mirrors getRepoLifecycle internals) ──────────

type EventType = 'agent_task_queued' | 'agent_pr_created' | 'agent_pr_merged' | 'agent_pr_rejected' | 'agent_execution_failed'
interface Event { eventType: EventType; metadata: Record<string, unknown>; occurredAt: Date }

function deriveStage(events: Event[], taskId: string): string {
  if (events.length === 0) return 'idle'
  const forTask = events.filter(e => e.metadata.taskId === taskId)
  if (forTask.find(e => e.eventType === 'agent_pr_merged'))       return 'merged'
  if (forTask.find(e => e.eventType === 'agent_execution_failed')) return 'failed'
  if (forTask.find(e => e.eventType === 'agent_pr_rejected'))     return 'rejected'
  if (forTask.find(e => e.eventType === 'agent_pr_created'))      return 'pr_ready'
  const queued = forTask.find(e => e.eventType === 'agent_task_queued')
  if (!queued) return 'idle'
  const age = Date.now() - queued.occurredAt.getTime()
  if (age > 15 * 60 * 1000) return 'timed_out'
  return 'queued'
}

const makeEvent = (type: EventType, taskId: string, ageMs = 0): Event => ({
  eventType: type,
  metadata: { taskId, prUrl: type === 'agent_pr_created' || type === 'agent_pr_merged' || type === 'agent_pr_rejected' ? 'https://github.com/test/r/pull/1' : undefined },
  occurredAt: new Date(Date.now() - ageMs),
})

describe('lifecycle stage derivation', () => {
  it('returns idle with no events', () => {
    expect(deriveStage([], 'task-1')).toBe('idle')
  })

  it('returns queued after task_queued with no follow-up', () => {
    const events = [makeEvent('agent_task_queued', 'task-1', 60_000)]
    expect(deriveStage(events, 'task-1')).toBe('queued')
  })

  it('returns pr_ready after pr_created', () => {
    const events = [
      makeEvent('agent_task_queued', 'task-1', 300_000),
      makeEvent('agent_pr_created',  'task-1', 60_000),
    ]
    expect(deriveStage(events, 'task-1')).toBe('pr_ready')
  })

  it('returns merged after pr_merged', () => {
    const events = [
      makeEvent('agent_task_queued', 'task-1', 600_000),
      makeEvent('agent_pr_created',  'task-1', 300_000),
      makeEvent('agent_pr_merged',   'task-1', 60_000),
    ]
    expect(deriveStage(events, 'task-1')).toBe('merged')
  })

  it('returns failed after execution_failed', () => {
    const events = [
      makeEvent('agent_task_queued',      'task-1', 300_000),
      makeEvent('agent_execution_failed', 'task-1', 60_000),
    ]
    expect(deriveStage(events, 'task-1')).toBe('failed')
  })

  it('returns timed_out when queued > 15 min with no follow-up', () => {
    const events = [makeEvent('agent_task_queued', 'task-1', 16 * 60_000)]
    expect(deriveStage(events, 'task-1')).toBe('timed_out')
  })

  it('merged wins over pr_ready for the same task', () => {
    const events = [
      makeEvent('agent_task_queued', 'task-1', 900_000),
      makeEvent('agent_pr_created',  'task-1', 600_000),
      makeEvent('agent_pr_merged',   'task-1', 60_000),
    ]
    expect(deriveStage(events, 'task-1')).toBe('merged')
  })

  it('returns rejected after pr_created + pr_rejected, not pr_ready', () => {
    const events = [
      makeEvent('agent_task_queued', 'task-1', 600_000),
      makeEvent('agent_pr_created',  'task-1', 300_000),
      makeEvent('agent_pr_rejected', 'task-1', 60_000),
    ]
    expect(deriveStage(events, 'task-1')).toBe('rejected')
  })

  it('ignores events for a different taskId', () => {
    const events = [
      makeEvent('agent_task_queued',  'task-1', 300_000),
      makeEvent('agent_pr_merged',    'task-2', 60_000),  // different task
    ]
    // task-1 has only queued event, not merged
    expect(deriveStage(events, 'task-1')).toBe('queued')
  })
})

// ─── Server-side guard logic ──────────────────────────────────────────────────

describe('blocking stage guard', () => {
  function shouldBlock(stage: string): boolean {
    return BLOCKING_STAGES.has(stage as never)
  }

  it('blocks queueing when task is already queued', () => {
    expect(shouldBlock('queued')).toBe(true)
  })

  it('blocks queueing when PR is open (pr_ready)', () => {
    expect(shouldBlock('pr_ready')).toBe(true)
  })

  it('allows queueing when previous task merged', () => {
    expect(shouldBlock('merged')).toBe(false)
  })

  it('allows retry when task failed', () => {
    expect(shouldBlock('failed')).toBe(false)
  })

  it('allows retry when PR was rejected (closed without merging)', () => {
    expect(shouldBlock('rejected')).toBe(false)
  })

  it('allows retry when task timed out', () => {
    expect(shouldBlock('timed_out')).toBe(false)
  })

  it('allows first queue when idle', () => {
    expect(shouldBlock('idle')).toBe(false)
  })
})
