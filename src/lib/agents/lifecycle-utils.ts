/** Pure constants for agent lifecycle — no DB imports, safe for unit tests. */

export type AgentLifecycleStage =
  | 'idle'
  | 'queued'
  | 'preparing'
  | 'running'
  | 'pr_ready'
  | 'merged'
  | 'failed'
  | 'timed_out'

/** Non-terminal stages — block new queueing */
export const BLOCKING_STAGES = new Set<AgentLifecycleStage>([
  'queued', 'preparing', 'running', 'pr_ready',
])

/** Terminal stages — allow new queue or retry */
export const TERMINAL_STAGES = new Set<AgentLifecycleStage>([
  'idle', 'merged', 'failed', 'timed_out',
])

export const LIFECYCLE_TIMEOUT_MS = 15 * 60 * 1000  // 15 minutes
