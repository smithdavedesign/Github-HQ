/**
 * Requests from RepoHQ (Run agent, skills, auto-dispatch), one per task by its outcome. The page
 * used to count events, so every retry's failure counted again (490 "failed" of 312 "queued").
 * Pure; the callers load the portfolio_events.
 */

export const REQUEST_EVENT_TYPES = ['agent_task_queued', 'agent_pr_created', 'agent_pr_merged', 'agent_execution_failed'] as const

export interface RequestEvent { eventType: string; metadata: unknown; occurredAt: Date }

export interface RequestStats {
  /** Tasks queued in the window. */
  queued: number
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

export function requestStats(events: RequestEvent[], now = new Date(), windowDays = 90): RequestStats {
  const since = now.getTime() - windowDays * 86_400_000
  const tasks = new Map<string, Set<string>>()
  let anonymous = 0
  for (const e of events) {
    if (e.occurredAt.getTime() < since) continue
    const id = taskIdOf(e)
    if (!id) { if (e.eventType === 'agent_task_queued') anonymous++; continue }
    const kinds = tasks.get(id) ?? new Set<string>()
    kinds.add(e.eventType)
    tasks.set(id, kinds)
  }
  const all = [...tasks.values()]
  const queued = all.length + anonymous
  const merged = all.filter(k => k.has('agent_pr_merged')).length
  const created = all.filter(k => k.has('agent_pr_created') || k.has('agent_pr_merged')).length
  const failed = all.filter(k => k.has('agent_execution_failed') && !k.has('agent_pr_created') && !k.has('agent_pr_merged')).length

  const thirtyDaysAgo = now.getTime() - 30 * 86_400_000
  const recentMerges = events.filter(e => e.eventType === 'agent_pr_merged' && e.occurredAt.getTime() >= thirtyDaysAgo)
  const totalScoreGained = recentMerges.reduce((sum, e) => sum + ((e.metadata as { actualDelta?: number } | null)?.actualDelta ?? 0), 0)

  return {
    queued, created, merged, failed,
    successRate: queued > 0 ? Math.round((merged / queued) * 100) : null,
    totalScoreGained, recentMergeCount: recentMerges.length, windowDays,
  }
}
