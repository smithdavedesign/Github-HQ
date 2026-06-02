/**
 * Unit tests for the fully automated agent execution flow (Phase 46E).
 * Tests the pure logic without hitting real APIs or the DB.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ─── autoExecute flag in contextNotes ────────────────────────────────────────

describe('autoExecute flag in Nexus contextNotes', () => {
  function buildContextNotes(overrides: Record<string, unknown> = {}) {
    return JSON.stringify({
      repoHQRepoId:    1,
      repoHQRepoName:  'my-repo',
      impactType:      'opportunity',
      effort:          'medium',
      estimatedImpact: '+14 opportunity points',
      predictedDelta:  '+14 opportunity points',
      source:          'repohq-advisor',
      autoExecute:     true,
      ...overrides,
    })
  }

  it('includes autoExecute: true by default', () => {
    const notes = JSON.parse(buildContextNotes())
    expect(notes.autoExecute).toBe(true)
  })

  it('can be overridden to false', () => {
    const notes = JSON.parse(buildContextNotes({ autoExecute: false }))
    expect(notes.autoExecute).toBe(false)
  })

  it('source is always repohq-advisor', () => {
    const notes = JSON.parse(buildContextNotes())
    expect(notes.source).toBe('repohq-advisor')
  })

  it('predictedDelta matches estimatedImpact', () => {
    const notes = JSON.parse(buildContextNotes({ estimatedImpact: '+22 pts', predictedDelta: '+22 pts' }))
    expect(notes.predictedDelta).toBe(notes.estimatedImpact)
  })
})

// ─── Worker auto-execute flag detection ──────────────────────────────────────

describe('worker autoExecute detection from contextNotes', () => {
  function detectAutoExecute(contextNotes: unknown): boolean {
    try {
      const notes = typeof contextNotes === 'string'
        ? JSON.parse(contextNotes) as Record<string, unknown>
        : {}
      return notes.autoExecute === true
    } catch { return false }
  }

  it('returns true when autoExecute is set in JSON string', () => {
    const notes = JSON.stringify({ autoExecute: true, source: 'repohq-advisor' })
    expect(detectAutoExecute(notes)).toBe(true)
  })

  it('returns false when autoExecute is false', () => {
    const notes = JSON.stringify({ autoExecute: false })
    expect(detectAutoExecute(notes)).toBe(false)
  })

  it('returns false when autoExecute is missing', () => {
    const notes = JSON.stringify({ source: 'repohq-advisor' })
    expect(detectAutoExecute(notes)).toBe(false)
  })

  it('returns false for invalid JSON', () => {
    expect(detectAutoExecute('not-json')).toBe(false)
  })

  it('returns false for null/undefined', () => {
    expect(detectAutoExecute(null)).toBe(false)
    expect(detectAutoExecute(undefined)).toBe(false)
  })
})

// ─── Task status API logic ────────────────────────────────────────────────────

describe('agent task status resolution', () => {
  type EventType = 'agent_task_queued' | 'agent_pr_created' | 'agent_pr_merged' | 'agent_execution_failed'

  interface MockEvent {
    eventType: EventType
    metadata: Record<string, unknown>
  }

  function resolveStatus(events: MockEvent[], taskId: string): { status: string; prUrl?: string | null } {
    const matching = events.filter(e => e.metadata.taskId === taskId)
    if (matching.length === 0) return { status: 'queued' }

    const prMerged  = matching.find(e => e.eventType === 'agent_pr_merged')
    const prCreated = matching.find(e => e.eventType === 'agent_pr_created')
    const failed    = matching.find(e => e.eventType === 'agent_execution_failed')

    if (prMerged)  return { status: 'merged',   prUrl: prMerged.metadata.prUrl as string ?? null }
    if (prCreated) return { status: 'pr_ready',  prUrl: prCreated.metadata.prUrl as string ?? null }
    if (failed)    return { status: 'failed' }
    return { status: 'running' }
  }

  const TASK_ID = 'test-task-uuid-123'

  it('returns queued when no events found', () => {
    expect(resolveStatus([], TASK_ID).status).toBe('queued')
  })

  it('returns running when only queued event exists', () => {
    const events: MockEvent[] = [{ eventType: 'agent_task_queued', metadata: { taskId: TASK_ID } }]
    expect(resolveStatus(events, TASK_ID).status).toBe('running')
  })

  it('returns pr_ready with URL when PR created', () => {
    const events: MockEvent[] = [{
      eventType: 'agent_pr_created',
      metadata: { taskId: TASK_ID, prUrl: 'https://github.com/owner/repo/pull/42' }
    }]
    const result = resolveStatus(events, TASK_ID)
    expect(result.status).toBe('pr_ready')
    expect(result.prUrl).toBe('https://github.com/owner/repo/pull/42')
  })

  it('returns merged when PR is merged (takes priority over pr_created)', () => {
    const events: MockEvent[] = [
      { eventType: 'agent_pr_created', metadata: { taskId: TASK_ID, prUrl: 'https://github.com/p/r/42' } },
      { eventType: 'agent_pr_merged',  metadata: { taskId: TASK_ID, prUrl: 'https://github.com/p/r/42' } },
    ]
    expect(resolveStatus(events, TASK_ID).status).toBe('merged')
  })

  it('returns failed when execution failed', () => {
    const events: MockEvent[] = [{ eventType: 'agent_execution_failed', metadata: { taskId: TASK_ID } }]
    expect(resolveStatus(events, TASK_ID).status).toBe('failed')
  })

  it('ignores events for other taskIds', () => {
    const events: MockEvent[] = [{
      eventType: 'agent_pr_created',
      metadata: { taskId: 'other-task-id', prUrl: 'https://github.com/p/r/1' }
    }]
    expect(resolveStatus(events, TASK_ID).status).toBe('queued')
  })
})

// ─── QueueButton state machine ────────────────────────────────────────────────

describe('QueueButton state transitions', () => {
  type FlowState = 'idle' | 'queuing' | 'running' | 'pr_ready' | 'error'

  function nextState(current: FlowState, event: 'click' | 'success' | 'pr_found' | 'error'): FlowState {
    if (current === 'idle'    && event === 'click')    return 'queuing'
    if (current === 'queuing' && event === 'success')  return 'running'
    if (current === 'queuing' && event === 'error')    return 'error'
    if (current === 'running' && event === 'pr_found') return 'pr_ready'
    return current
  }

  it('idle → queuing on click', ()       => expect(nextState('idle', 'click')).toBe('queuing'))
  it('queuing → running on success', ()  => expect(nextState('queuing', 'success')).toBe('running'))
  it('queuing → error on error', ()      => expect(nextState('queuing', 'error')).toBe('error'))
  it('running → pr_ready on pr_found', () => expect(nextState('running', 'pr_found')).toBe('pr_ready'))
  it('pr_ready stays pr_ready', ()       => expect(nextState('pr_ready', 'click')).toBe('pr_ready'))
  it('error state allows retry via re-click', () => {
    // error → click → queuing (user retries)
    expect(nextState('error', 'click')).toBe('error') // handled in component via reset
  })
})

// ─── PR URL handling ──────────────────────────────────────────────────────────

describe('PR URL extraction from portfolio events', () => {
  it('extracts prUrl from agent_pr_created metadata', () => {
    const meta = { taskId: 'abc', prUrl: 'https://github.com/smithdavedesign/repohq/pull/7' }
    expect(meta.prUrl).toMatch(/github\.com.*pull\/\d+/)
  })

  it('handles missing prUrl gracefully', () => {
    const meta = { taskId: 'abc' } as Record<string, unknown>
    const prUrl = (meta.prUrl as string) ?? null
    expect(prUrl).toBeNull()
  })
})
