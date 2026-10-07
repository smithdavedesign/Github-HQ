/**
 * The worker's status record and what it means (factory/worker.ts writes it to Redis under
 * WORKER_STATUS_KEY; the Agents page reads it). Pure and dependency-free so the browser bundle can
 * import it: factory/lib/queue.ts pulls in BullMQ, this must not.
 */

/** A status older than this means the worker isn't running (or can't reach Redis). */
export const WORKER_FRESH_MS = 3 * 60_000

/** What the worker publishes about itself under WORKER_STATUS_KEY (read by the Agents page). */
export interface WorkerStatus {
  host: string
  pid: number
  startedAt: string
  lastSeenAt: string
  /** ~/.repohq-factory/PAUSE exists. */
  pausedFile: boolean
  /** null when unknown (not macOS). */
  onAc: boolean | null
  /** null when the sandbox is off (Docker isn't needed). */
  dockerUp: boolean | null
  /** Deployed commit of the worker (install-launchd.sh pins a checkout). */
  version: string | null
  activeJob: { id: string; name: string; since: string } | null
  /** Something the running worker can't get past on its own (worker-health.ts), else null. */
  problem?: string | null
  /** Set by a clean shutdown (SIGTERM/SIGINT): the worker stopped, it didn't vanish. */
  stoppedAt?: string | null
  stopReason?: string | null
  /** Recent start times (newest last), to tell a worker launchd keeps restarting. */
  starts?: string[]
}

export function parseWorkerStatus(raw: string | null): WorkerStatus | null {
  if (!raw) return null
  try {
    const s = JSON.parse(raw) as Partial<WorkerStatus>
    return typeof s.host === 'string' && typeof s.lastSeenAt === 'string' ? (s as WorkerStatus) : null
  } catch {
    return null
  }
}

/** This many starts inside RESTART_WINDOW_MS means launchd is restarting a worker that keeps exiting. */
export const RESTART_LOOP_STARTS = 3
const RESTART_WINDOW_MS = 15 * 60_000

/**
 * What the Agents page says about the worker. Two different situations used to read the same
 * ("offline"):
 *  - off: nothing is running to report, because the Mac is asleep, shut down or offline, or the
 *    worker was stopped. Requests just wait; nothing is broken.
 *  - not-working: the worker is up but can't do its job (it says why), or launchd keeps
 *    restarting it. Something needs fixing.
 */
export type WorkerState =
  | { kind: 'online' }
  | { kind: 'not-working'; reason: string }
  | { kind: 'off'; lastSeenAt: string; stopped: string | null }
  | { kind: 'not-set-up' }

export function workerState(status: WorkerStatus | null, now: number): WorkerState {
  if (!status) return { kind: 'not-set-up' }
  if (status.stoppedAt) return { kind: 'off', lastSeenAt: status.stoppedAt, stopped: status.stopReason ?? 'stopped' }
  // Before the staleness check: a worker that dies soon after each start is broken, not asleep.
  const recent = (status.starts ?? []).filter(s => now - Date.parse(s) < RESTART_WINDOW_MS)
  if (recent.length >= RESTART_LOOP_STARTS) {
    return { kind: 'not-working', reason: `it keeps restarting (${recent.length} starts in 15 min) — see ~/.repohq-factory/logs/launchd-worker.err` }
  }
  if (now - Date.parse(status.lastSeenAt) >= WORKER_FRESH_MS) return { kind: 'off', lastSeenAt: status.lastSeenAt, stopped: null }
  if (status.problem) return { kind: 'not-working', reason: status.problem }
  if (status.dockerUp === false) return { kind: 'not-working', reason: 'Docker isn\'t running, so cycles and requests wait — start Docker Desktop' }
  return { kind: 'online' }
}
