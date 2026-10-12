/**
 * Requests from RepoHQ (Run agent, skills, auto-dispatch), one per task by its outcome. The page
 * used to count events, so every retry's failure counted again (490 "failed" of 312 "queued").
 * Report-only requests (mode 'report', or ending in a skill report) can't open a PR, so they're
 * counted apart and left out of the merge rate. Pure; the callers load the portfolio_events.
 */

export const REQUEST_EVENT_TYPES = ['agent_task_queued', 'agent_pr_created', 'agent_pr_merged', 'agent_execution_failed', 'agent_skill_report'] as const

/** 30 days, like the factory line: a 90-day window was mostly the executors before the factory (2026-10-05). */
export const REQUEST_WINDOW_DAYS = 30

export interface RequestEvent { eventType: string; metadata: unknown; occurredAt: Date }

export interface RequestStats {
  /** Tasks queued in the window that could open a PR (report-only requests are in `reports`). */
  queued: number
  /** Report-only requests in the window: findings, never a PR. */
  reports: number
  /** Of those: a PR was opened. */
  created: number
  merged: number
  /** Failed and never opened a PR (a retry that worked doesn't count as a failure). */
  failed: number
  /** merged / queued, as a percentage; null with nothing queued. */
  successRate: number | null
  /** Health points from merges in the last 30 days (webhook-measured actualDelta). */
  totalScoreGained: number
  recentMergeCount: number
  windowDays: number
}

const taskIdOf = (e: RequestEvent) => (e.metadata as { taskId?: string } | null)?.taskId
const isReport = (e: RequestEvent) =>
  e.eventType === 'agent_skill_report' || (e.eventType === 'agent_task_queued' && (e.metadata as { mode?: string } | null)?.mode === 'report')

export function requestStats(events: RequestEvent[], now = new Date(), windowDays = REQUEST_WINDOW_DAYS): RequestStats {
  const since = now.getTime() - windowDays * 86_400_000
  const tasks = new Map<string, Set<string>>()
  let anonymous = 0
  for (const e of events) {
    if (e.occurredAt.getTime() < since) continue
    const id = taskIdOf(e)
    if (!id) { if (e.eventType === 'agent_task_queued') anonymous++; continue }
    const kinds = tasks.get(id) ?? new Set<string>()
    kinds.add(e.eventType)
    if (isReport(e)) kinds.add('report')
    tasks.set(id, kinds)
  }
  // A skill report on its own (no queued event in the window) isn't a request to count.
  const requested = [...tasks.values()].filter(k => k.has('agent_task_queued') || k.has('agent_pr_created') || k.has('agent_pr_merged') || k.has('agent_execution_failed'))
  const reports = requested.filter(k => k.has('report')).length
  const all = requested.filter(k => !k.has('report'))
  const queued = all.length + anonymous
  const merged = all.filter(k => k.has('agent_pr_merged')).length
  const created = all.filter(k => k.has('agent_pr_created') || k.has('agent_pr_merged')).length
  const failed = all.filter(k => k.has('agent_execution_failed') && !k.has('agent_pr_created') && !k.has('agent_pr_merged')).length

  const thirtyDaysAgo = now.getTime() - 30 * 86_400_000
  const recentMerges = events.filter(e => e.eventType === 'agent_pr_merged' && e.occurredAt.getTime() >= thirtyDaysAgo)
  const totalScoreGained = recentMerges.reduce((sum, e) => sum + ((e.metadata as { actualDelta?: number } | null)?.actualDelta ?? 0), 0)

  return {
    queued, reports, created, merged, failed,
    successRate: queued > 0 ? Math.round((merged / queued) * 100) : null,
    totalScoreGained, recentMergeCount: recentMerges.length, windowDays,
  }
}
