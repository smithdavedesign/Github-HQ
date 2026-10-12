import { describe, it, expect } from 'vitest'
import { requestStats } from '@/lib/agents/request-stats'

const now = new Date('2026-10-12T12:00:00Z')
const ago = (d: number) => new Date(now.getTime() - d * 86_400_000)
const ev = (eventType: string, taskId: string | null, days = 1, actualDelta?: number) =>
  ({ eventType, occurredAt: ago(days), metadata: taskId ? { taskId, ...(actualDelta !== undefined ? { actualDelta } : {}) } : null })

describe('requestStats', () => {
  it('counts each task once by its outcome: a retried failure is one failure, never more than were queued', () => {
    const s = requestStats([
      ev('agent_task_queued', 'a'), ev('agent_execution_failed', 'a'), ev('agent_execution_failed', 'a'), ev('agent_execution_failed', 'a'),
      ev('agent_task_queued', 'b'), ev('agent_execution_failed', 'b'), ev('agent_pr_created', 'b'), ev('agent_pr_merged', 'b', 1, 6),
      ev('agent_task_queued', 'c'), ev('agent_pr_created', 'c'),
    ], now)
    expect(s).toMatchObject({ queued: 3, created: 2, merged: 1, failed: 1, successRate: 33, totalScoreGained: 6, recentMergeCount: 1, windowDays: 90 })
    expect(s.failed).toBeLessThanOrEqual(s.queued)
  })

  it('leaves out tasks older than the window, and counts queued events without a task id once each', () => {
    const s = requestStats([ev('agent_task_queued', 'old', 200), ev('agent_execution_failed', 'old', 200), ev('agent_task_queued', null, 5)], now)
    expect(s).toMatchObject({ queued: 1, failed: 0, merged: 0, successRate: 0 })
  })

  it('has no rate with nothing queued', () => {
    expect(requestStats([], now).successRate).toBeNull()
  })
})
