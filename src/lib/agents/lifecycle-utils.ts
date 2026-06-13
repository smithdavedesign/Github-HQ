/** Pure constants for agent lifecycle — no DB imports, safe for unit tests. */

export type AgentLifecycleStage =
  | 'idle'
  | 'queued'
  | 'preparing'
  | 'running'
  | 'pr_ready'
  | 'ci_failing'    // PR open, CI failed — auto-fix being queued
  | 'needs_human'   // CI failed 3 times — human intervention required
  | 'merged'
  | 'report_ready'
  | 'failed'
  | 'timed_out'

/** Non-terminal stages — block new queueing */
export const BLOCKING_STAGES = new Set<AgentLifecycleStage>([
  'queued', 'preparing', 'running', 'pr_ready', 'ci_failing',
])

/** Terminal stages — allow new queue or retry */
export const TERMINAL_STAGES = new Set<AgentLifecycleStage>([
  'idle', 'merged', 'report_ready', 'failed', 'timed_out', 'needs_human',
])

export const LIFECYCLE_TIMEOUT_MS = 15 * 60 * 1000  // 15 minutes
