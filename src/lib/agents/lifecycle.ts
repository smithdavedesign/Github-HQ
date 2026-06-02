import { db } from '@/lib/db'
import { portfolioEvents } from '@/lib/db/schema'
import { eq, and, inArray, desc } from 'drizzle-orm'
import {
  LIFECYCLE_TIMEOUT_MS,
  type AgentLifecycleStage,
} from './lifecycle-utils'

export type { AgentLifecycleStage }
export { BLOCKING_STAGES, TERMINAL_STAGES } from './lifecycle-utils'

export interface RepoLifecycle {
  stage: AgentLifecycleStage
  taskId: string | null   // active taskId — used to resume polling
  prUrl: string | null
  queuedAt: Date | null
}

/**
 * Returns the current agent lifecycle stage for a repo.
 *
 * Projects portfolio_events into a single stage value — no new DB table needed.
 * Uses the same event types as the status polling API but scoped to repoId.
 */
export async function getRepoLifecycle(userId: string, repoId: number): Promise<RepoLifecycle> {
  const IDLE: RepoLifecycle = { stage: 'idle', taskId: null, prUrl: null, queuedAt: null }

  let events: Array<{ eventType: string; metadata: unknown; occurredAt: Date }>
  try {
    events = await db.query.portfolioEvents.findMany({
      where: and(
        eq(portfolioEvents.userId, userId),
        eq(portfolioEvents.repoId, repoId),
        inArray(portfolioEvents.eventType, [
          'agent_task_queued',
          'agent_pr_created',
          'agent_pr_merged',
          'agent_execution_failed',
        ]),
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

  const meta = lastQueued.metadata as { taskId?: string } | null
  const taskId = meta?.taskId ?? null
  const queuedAt = lastQueued.occurredAt

  // If no taskId we can't correlate — treat as idle
  if (!taskId) return IDLE

  // Check for terminal events matching this taskId
  const eventsForTask = events.filter(e => {
    const m = e.metadata as { taskId?: string } | null
    return m?.taskId === taskId
  })

  const mergedEvent = eventsForTask.find(e => e.eventType === 'agent_pr_merged')
  if (mergedEvent) {
    const m = mergedEvent.metadata as { prUrl?: string } | null
    return { stage: 'merged', taskId, prUrl: m?.prUrl ?? null, queuedAt }
  }

  const failedEvent = eventsForTask.find(e => e.eventType === 'agent_execution_failed')
  if (failedEvent) {
    return { stage: 'failed', taskId, prUrl: null, queuedAt }
  }

  const prCreatedEvent = eventsForTask.find(e => e.eventType === 'agent_pr_created')
  if (prCreatedEvent) {
    const m = prCreatedEvent.metadata as { prUrl?: string } | null
    return { stage: 'pr_ready', taskId, prUrl: m?.prUrl ?? null, queuedAt }
  }

  // No terminal or PR event — task is in flight, check for timeout
  const age = Date.now() - queuedAt.getTime()
  if (age > LIFECYCLE_TIMEOUT_MS) {
    return { stage: 'timed_out', taskId, prUrl: null, queuedAt }
  }

  return { stage: 'queued', taskId, prUrl: null, queuedAt }
}
