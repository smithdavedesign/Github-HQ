import { db } from '@/lib/db'
import { agentRequests, portfolioEvents } from '@/lib/db/schema'
import { eq, and, inArray, desc } from 'drizzle-orm'
import {
  LIFECYCLE_TIMEOUT_MS,
  prFollowUpStage,
  type AgentLifecycleStage,
} from './lifecycle-utils'
import { stageForRequest } from './factory-request-utils'

export type { AgentLifecycleStage }
export { BLOCKING_STAGES, TERMINAL_STAGES } from './lifecycle-utils'

export interface RepoLifecycle {
  stage: AgentLifecycleStage
  taskId: string | null   // active taskId — used to resume polling
  prUrl: string | null
  queuedAt: Date | null
  /** Factory requests (Phase 81): why it's waiting, failed or was rejected. */
  reason?: string | null
}

const TASK_EVENT_TYPES = [
  'agent_task_queued',
  'agent_pr_created',
  'agent_pr_merged',
  'agent_pr_rejected',
  'agent_execution_failed',
  'agent_skill_report',
  'agent_ci_failed',
  'agent_needs_human',
  'agent_awaiting_approval',
]

type TaskEvent = { eventType: string; metadata: unknown; occurredAt: Date }

const prUrlOf = (e: TaskEvent | undefined) => (e?.metadata as { prUrl?: string } | null)?.prUrl ?? null

/**
 * After a PR exists: merged / closed / needs human / CI failing, from the PR events the
 * sync cron writes (pr-merge-checker, ci-checker). Null while the PR is simply open.
 */
function prFollowUp(eventsForTask: TaskEvent[]): { stage: AgentLifecycleStage; prUrl: string | null } | null {
  const followUp = prFollowUpStage(eventsForTask)
  return followUp && { stage: followUp.stage, prUrl: prUrlOf(followUp.event) }
}

/**
 * Returns the current agent lifecycle stage for a repo.
 *
 * Factory requests (roadmap Phase 81) are read from their agent_requests row — the factory may
 * take hours to pick one up, so there's no timeout — with PR outcomes from portfolio_events.
 * Older Nexus tasks are still projected from portfolio_events alone.
 */
export async function getRepoLifecycle(userId: string, repoId: number): Promise<RepoLifecycle> {
  const IDLE: RepoLifecycle = { stage: 'idle', taskId: null, prUrl: null, queuedAt: null }

  let events: TaskEvent[]
  try {
    events = await db.query.portfolioEvents.findMany({
      where: and(
        eq(portfolioEvents.userId, userId),
        eq(portfolioEvents.repoId, repoId),
        inArray(portfolioEvents.eventType, TASK_EVENT_TYPES),
      ),
      columns: { eventType: true, metadata: true, occurredAt: true },
      orderBy: [desc(portfolioEvents.occurredAt)],
      limit: 20,
    })
  } catch {
    return IDLE
  }

  if (events.length === 0) return IDLE

  // Find the most recent queued event — this represents the "current task"
  const lastQueued = events.find(e => e.eventType === 'agent_task_queued')
  if (!lastQueued) return IDLE

  const meta = lastQueued.metadata as { taskId?: string; executor?: string } | null
  const taskId = meta?.taskId ?? null
  const queuedAt = lastQueued.occurredAt

  // If no taskId we can't correlate — treat as idle
  if (!taskId) return IDLE

  // Check for terminal events matching this taskId
  const eventsForTask = events.filter(e => {
    const m = e.metadata as { taskId?: string } | null
    return m?.taskId === taskId
  })

  if (meta?.executor === 'factory') {
    const row = await db.query.agentRequests.findFirst({
      where: and(eq(agentRequests.id, taskId), eq(agentRequests.userId, userId)),
      columns: { status: true, prUrl: true, reason: true },
    }).catch(() => undefined)
    if (row) {
      if (row.status === 'pr') {
        const followUp = prFollowUp(eventsForTask)
        return { stage: followUp?.stage ?? 'pr_ready', taskId, prUrl: followUp?.prUrl ?? row.prUrl, queuedAt, reason: row.reason }
      }
      return { stage: stageForRequest(row.status), taskId, prUrl: row.prUrl, queuedAt, reason: row.reason }
    }
  }

  const mergedEvent = eventsForTask.find(e => e.eventType === 'agent_pr_merged')
  if (mergedEvent) return { stage: 'merged', taskId, prUrl: prUrlOf(mergedEvent), queuedAt }

  const skillReportEvent = eventsForTask.find(e => e.eventType === 'agent_skill_report')
  if (skillReportEvent) return { stage: 'report_ready', taskId, prUrl: null, queuedAt }

  const failedEvent = eventsForTask.find(e => e.eventType === 'agent_execution_failed')
  if (failedEvent) return { stage: 'failed', taskId, prUrl: null, queuedAt }

  const followUp = prFollowUp(eventsForTask)
  if (followUp) return { ...followUp, taskId, queuedAt }

  const prCreatedEvent = eventsForTask.find(e => e.eventType === 'agent_pr_created')
  if (prCreatedEvent) return { stage: 'pr_ready', taskId, prUrl: prUrlOf(prCreatedEvent), queuedAt }

  // No terminal or PR event — a legacy task in flight; check for timeout
  const age = Date.now() - queuedAt.getTime()
  if (age > LIFECYCLE_TIMEOUT_MS) {
    return { stage: 'timed_out', taskId, prUrl: null, queuedAt }
  }

  return { stage: 'queued', taskId, prUrl: null, queuedAt }
}
