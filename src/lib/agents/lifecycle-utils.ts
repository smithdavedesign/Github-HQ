/** Pure constants for agent lifecycle — no DB imports, safe for unit tests. */

export type AgentLifecycleStage =
  | 'idle'
  | 'queued'
  | 'preparing'
  | 'running'
  | 'pr_ready'
  | 'ci_failing'    // PR open, CI failing on it
  | 'needs_human'   // PR open, CI failing, handed to the owner: nothing fixes it automatically
  | 'awaiting_approval' // Human approval required before continuing an autonomous action
  | 'merged'
  | 'rejected'      // PR closed without merging — terminal, not actionable
  | 'report_ready'
  | 'verified'      // factory request passed the judge but no PR: owner-requested is at stage `report`
  | 'failed'
  | 'timed_out'

/**
 * Non-terminal stages — block new queueing on the repo: a request in flight, or an agent PR that
 * is still open, whatever its CI says, until it's merged or closed.
 */
export const BLOCKING_STAGES = new Set<AgentLifecycleStage>([
  'queued', 'preparing', 'running', 'pr_ready', 'ci_failing', 'needs_human',
])

/** Terminal stages — allow new queue or retry */
export const TERMINAL_STAGES = new Set<AgentLifecycleStage>([
  'idle', 'merged', 'rejected', 'report_ready', 'verified', 'failed', 'timed_out', 'awaiting_approval',
])

/** PR events (pr-merge-checker, ci-checker) and the stage each one puts its task in. */
const PR_EVENT_STAGES = new Map<string, AgentLifecycleStage>([
  ['agent_pr_merged', 'merged'],
  ['agent_pr_rejected', 'rejected'],
  ['agent_needs_human', 'needs_human'],
  ['agent_ci_failed', 'ci_failing'],
  ['agent_awaiting_approval', 'awaiting_approval'],
])

/**
 * A task's stage once its PR exists, from the task's events newest first; null while the PR is
 * simply open (pr_ready). A merge is final. Otherwise the newest event wins: a PR failing CI
 * blocks its repo until it's closed, and blocks it again if it's reopened and fails.
 */
export function prFollowUpStage<E extends { eventType: string }>(eventsNewestFirst: E[]): { stage: AgentLifecycleStage; event: E } | null {
  const merged = eventsNewestFirst.find(e => e.eventType === 'agent_pr_merged')
  if (merged) return { stage: 'merged', event: merged }
  const latest = eventsNewestFirst.find(e => PR_EVENT_STAGES.has(e.eventType))
  return latest ? { stage: PR_EVENT_STAGES.get(latest.eventType)!, event: latest } : null
}

/**
 * Task ids whose agent PR no longer holds its repo: merged, or closed without merging
 * (agent_pr_rejected, written by the PR checker). Counting only merges left closed PRs badged
 * "PR open" on the repos page (found 2026-10-07).
 */
export function closedPrTaskIds(events: { eventType: string; metadata: unknown }[]): Set<string> {
  const ids = new Set<string>()
  for (const e of events) {
    if (e.eventType !== 'agent_pr_merged' && e.eventType !== 'agent_pr_rejected') continue
    const taskId = (e.metadata as { taskId?: string } | null)?.taskId
    if (taskId) ids.add(taskId)
  }
  return ids
}

export const DEFAULT_MAX_AUTONOMOUS_RETRIES = 3
export const AUTONOMOUS_TERMINAL_REASONS = ['merged', 'failed', 'timed_out', 'needs_human', 'awaiting_approval', 'rejected'] as const
export type AutonomousStopReason = typeof AUTONOMOUS_TERMINAL_REASONS[number]

export function isTerminalStage(stage: AgentLifecycleStage): boolean {
  return TERMINAL_STAGES.has(stage)
}

export function isRetryEligible(retryCount: number, maxAttempts = DEFAULT_MAX_AUTONOMOUS_RETRIES): boolean {
  if (!Number.isInteger(retryCount) || retryCount < 0) return false
  return retryCount < Math.max(1, maxAttempts)
}

export function shouldContinueAutonomousLoop({
  retryCount,
  maxAttempts = DEFAULT_MAX_AUTONOMOUS_RETRIES,
  lifecycleStage,
  stopReason,
  autoDispatchEnabled = true,
}: {
  retryCount: number
  maxAttempts?: number
  lifecycleStage?: AgentLifecycleStage | string | null
  stopReason?: string | null
  autoDispatchEnabled?: boolean
}): boolean {
  if (!autoDispatchEnabled) return false
  if (!isRetryEligible(retryCount, maxAttempts)) return false
  if (typeof stopReason === 'string' && AUTONOMOUS_TERMINAL_REASONS.includes(stopReason as AutonomousStopReason)) {
    return false
  }
  // needs_human blocks new requests (its PR is open) but ends the loop all the same.
  if (lifecycleStage && (isTerminalStage(lifecycleStage as AgentLifecycleStage) || AUTONOMOUS_TERMINAL_REASONS.includes(lifecycleStage as AutonomousStopReason))) {
    return false
  }
  return true
}

export const LIFECYCLE_TIMEOUT_MS = 15 * 60 * 1000  // 15 minutes
