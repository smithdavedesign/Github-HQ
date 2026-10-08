/**
 * The worker's self-check. On 2026-10-07 its status writes hung for good on a Redis connection
 * Render's proxy had dropped without closing it: the worker kept running jobs on its other
 * connections, but the Agents page called it "offline". Each heartbeat is now bounded by a
 * timeout, and this decides what a failed one, or a queue nobody is taking jobs from, means.
 *
 * Pure: worker.ts does the I/O.
 */

/** A status write that takes longer than this counts as failed. */
export const HEARTBEAT_TIMEOUT_MS = 10_000

/**
 * Consecutive failed heartbeats before an idle worker exits so launchd restarts it with fresh
 * connections. Before that, each failure only reconnects the status connection (a command still
 * waiting on the old one is resent on the new one).
 */
export const EXIT_AFTER_FAILURES = 5

/** Jobs waiting this long while nothing runs mean the worker's own connection stopped taking them. */
export const STUCK_PICKUP_MS = 10 * 60_000

export type HeartbeatAction = 'reconnect' | 'exit'

/** After `failures` heartbeats failed in a row. A busy worker never exits: its job may be fine. */
export function heartbeatAction(failures: number, busy: boolean): HeartbeatAction {
  return failures >= EXIT_AFTER_FAILURES && !busy ? 'exit' : 'reconnect'
}

/**
 * Stuck = jobs have been waiting past STUCK_PICKUP_MS while nothing ran: the worker should be
 * taking them, so its own connection has stopped. Measured from when the worker first saw them
 * waiting, not from job timestamps: a deferred request keeps its old creation time. Gated jobs
 * (PAUSE, on battery, lock held) don't wait, the worker moves them to delayed, and the caller
 * skips the check while the queue is paused.
 */
export function pickupCheck(q: { waiting: number; active: number }, waitingSince: number | null, now: number): { waitingSince: number | null; stuck: boolean } {
  if (q.waiting === 0 || q.active > 0) return { waitingSince: null, stuck: false }
  const since = waitingSince ?? now
  return { waitingSince: since, stuck: now - since > STUCK_PICKUP_MS }
}

/** The status record's start history: this start plus the earlier ones from the last hour (max 10). */
export function recentStarts(previous: string[] | undefined, now: Date): string[] {
  const hourAgo = now.getTime() - 60 * 60_000
  return [...(previous ?? []).filter(s => Date.parse(s) > hourAgo), now.toISOString()].slice(-10)
}

/** The status record's `problem` when the worker can't load requests (it still runs scheduled work). */
export function configProblem(sink: { userId?: string | null; databaseUrl?: string | null }): string | null {
  if (sink.userId && sink.databaseUrl) return null
  const missing = !sink.userId ? 'FACTORY_USER_ID isn\'t set in ~/.repohq-factory/env' : 'the database URL isn\'t in the keychain (repohq-factory-database-url)'
  return `requests can't run: ${missing} — scheduled cycles still run`
}
