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
    expect(s).toMatchObject({ queued: 3, created: 2, merged: 1, failed: 1, successRate: 33, totalScoreGained: 6, recentMergeCount: 1, windowDays: 30 })
    expect(s.failed).toBeLessThanOrEqual(s.queued)
  })

  it('leaves out tasks older than the window, and counts queued events without a task id once each', () => {
    const s = requestStats([ev('agent_task_queued', 'old', 200), ev('agent_execution_failed', 'old', 200), ev('agent_task_queued', null, 5)], now, 90)
    expect(s).toMatchObject({ queued: 1, failed: 0, merged: 0, successRate: 0 })
  })

  it('counts report-only requests apart, so findings runs never drag down the merge rate', () => {
    const report = (taskId: string) => ({ eventType: 'agent_task_queued', occurredAt: ago(2), metadata: { taskId, mode: 'report' } })
    const s = requestStats([
      report('r1'), report('r2'),
      ev('agent_task_queued', 'r3'), ev('agent_skill_report', 'r3'),
      ev('agent_task_queued', 'f'), ev('agent_pr_created', 'f'), ev('agent_pr_merged', 'f'),
      ev('agent_skill_report', 'stray'),
    ], now)
    expect(s).toMatchObject({ queued: 1, reports: 3, created: 1, merged: 1, successRate: 100 })
  })

  it('defaults to the last 30 days, like the factory line', () => {
    const s = requestStats([ev('agent_task_queued', 'old', 45), ev('agent_task_queued', 'new', 10)], now)
    expect(s).toMatchObject({ queued: 1, windowDays: 30 })
  })

  it('has no rate with nothing queued', () => {
    expect(requestStats([], now).successRate).toBeNull()
  })
})
