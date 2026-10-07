/** Pure constants for agent lifecycle — no DB imports, safe for unit tests. */

export type AgentLifecycleStage =
  | 'idle'
  | 'queued'
  | 'preparing'
  | 'running'
  | 'pr_ready'
  | 'ci_failing'    // PR open, CI failed — auto-fix being queued
  | 'needs_human'   // CI failed 3 times — human intervention required
  | 'awaiting_approval' // Human approval required before continuing an autonomous action
  | 'merged'
  | 'rejected'      // PR closed without merging — terminal, not actionable
  | 'report_ready'
  | 'verified'      // factory request passed the judge but no PR: owner-requested is at stage `report`
  | 'failed'
  | 'timed_out'

/** Non-terminal stages — block new queueing */
export const BLOCKING_STAGES = new Set<AgentLifecycleStage>([
  'queued', 'preparing', 'running', 'pr_ready', 'ci_failing',
])

/** Terminal stages — allow new queue or retry */
export const TERMINAL_STAGES = new Set<AgentLifecycleStage>([
  'idle', 'merged', 'rejected', 'report_ready', 'verified', 'failed', 'timed_out', 'needs_human', 'awaiting_approval',
])

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
  if (lifecycleStage && isTerminalStage(lifecycleStage as AgentLifecycleStage)) {
    return false
  }
  return true
}

export const LIFECYCLE_TIMEOUT_MS = 15 * 60 * 1000  // 15 minutes
