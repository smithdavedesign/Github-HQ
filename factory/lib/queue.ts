import { Queue, type ConnectionOptions, type JobsOptions } from 'bullmq'

/**
 * The queue contract between RepoHQ (producer, on Vercel) and the factory worker (consumer, on
 * the Mac): docs/agent-hq-migration-prd.md §6. Both sides import this module, so it must stay
 * free of Next.js and of anything that only exists on the Mac.
 *
 * Payloads carry ids only. The worker loads every request from Neon and re-checks the factory
 * allowlist, so anyone able to write to Redis can at most trigger an ordinary cycle — never
 * inject an objective (PRD §10). Neon, not Redis, is the record of what was asked and what
 * happened; a lost Redis loses nothing (the worker re-queues pending rows).
 */

export const QUEUE_NAME = 'factory'
/** Redis key namespace (BullMQ's `prefix`), so the queue never collides with anything else. */
export const QUEUE_PREFIX = 'agent-hq'
/** Liveness record the worker refreshes; it expires on its own when the worker stops. */
export const WORKER_STATUS_KEY = `${QUEUE_PREFIX}:factory-worker`
export const WORKER_STATUS_TTL_SECONDS = 180

export const JOB_NAMES = ['request', 'cycle', 'report', 'scout'] as const
export type FactoryJobName = typeof JOB_NAMES[number]
export type ScheduledJobName = Exclude<FactoryJobName, 'request'>

export interface RequestJobData {
  requestId: string
  /** Failed runs so far (the worker retries a request up to MAX_REQUEST_ATTEMPTS failures). */
  failures?: number
}
export interface ScheduledJobData { trigger: 'schedule' | 'manual' }

/** Requests are explicit human intent: they run before scheduled work (lower = sooner). */
export const JOB_PRIORITY: Record<FactoryJobName, number> = { request: 1, cycle: 5, report: 5, scout: 5 }

/** Finished jobs stay long enough for the Agents page; the durable history is in Neon. */
const RETENTION: Pick<JobsOptions, 'removeOnComplete' | 'removeOnFail'> = {
  removeOnComplete: { age: 7 * 86_400, count: 500 },
  removeOnFail: { age: 14 * 86_400, count: 500 },
}

export function isFactoryJobName(name: string): name is FactoryJobName {
  return (JOB_NAMES as readonly string[]).includes(name)
}

/** BullMQ job options for a request; `jobId` = request id makes re-adding idempotent. */
export function requestJobOptions(requestId: string, delayMs = 0): JobsOptions {
  return { jobId: requestId, priority: JOB_PRIORITY.request, ...(delayMs > 0 ? { delay: delayMs } : {}), ...RETENTION }
}

/** BullMQ job options for a scheduled kind run on demand ("Run now"). */
export function manualJobOptions(name: ScheduledJobName, now: Date): JobsOptions {
  return { jobId: `manual-${name}-${now.getTime()}`, priority: JOB_PRIORITY[name], ...RETENTION }
}

/** Template the worker's job schedulers create jobs from. */
export function scheduledJobTemplate(name: ScheduledJobName): { name: ScheduledJobName; data: ScheduledJobData; opts: Pick<JobsOptions, 'priority' | 'removeOnComplete' | 'removeOnFail'> } {
  return { name, data: { trigger: 'schedule' }, opts: { priority: JOB_PRIORITY[name], ...RETENTION } }
}

/**
 * ioredis options from a redis:// or rediss:// URL (Render's external Key Value URL is rediss://,
 * which needs TLS). Credentials stay in the options object and never reach a log line.
 */
export function redisOptionsFromUrl(url: string): { host: string; port: number; username?: string; password?: string; db?: number; tls?: Record<string, never> } {
  const u = new URL(url)
  if (u.protocol !== 'redis:' && u.protocol !== 'rediss:') throw new Error('REDIS_URL must start with redis:// or rediss://')
  const db = u.pathname.length > 1 ? Number(u.pathname.slice(1)) : undefined
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    ...(u.username ? { username: decodeURIComponent(u.username) } : {}),
    ...(u.password ? { password: decodeURIComponent(u.password) } : {}),
    ...(db !== undefined && Number.isInteger(db) ? { db } : {}),
    ...(u.protocol === 'rediss:' ? { tls: {} } : {}),
  }
}

/**
 * Connection for short-lived producers (Vercel functions, the MCP server, scripts): fail fast
 * instead of queueing commands while Redis is unreachable, so a request falls back to its Neon
 * row (re-queued by the worker) rather than hanging the caller.
 */
export function producerConnection(url: string): ConnectionOptions {
  return { ...redisOptionsFromUrl(url), enableOfflineQueue: false, maxRetriesPerRequest: 1, connectTimeout: 5_000 }
}

/** Connection for the long-running worker: BullMQ requires maxRetriesPerRequest null for blocking calls. */
export function workerConnection(url: string): ConnectionOptions {
  return { ...redisOptionsFromUrl(url), maxRetriesPerRequest: null }
}

/**
 * Open the queue, run `fn`, close it. Short-lived producers connect per call: a handful of
 * requests a day doesn't justify a pooled connection that a frozen serverless function would
 * leave half-open. Rejects after `timeoutMs` so a slow Redis can't hold up a page or an action.
 */
export async function withQueue<T>(url: string, fn: (queue: Queue) => Promise<T>, timeoutMs = 8_000): Promise<T> {
  const queue = new Queue(QUEUE_NAME, { connection: producerConnection(url), prefix: QUEUE_PREFIX })
  // Connection errors surface through the awaited call below; don't let them become unhandled events.
  queue.on('error', () => {})
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      fn(queue),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`Redis did not answer within ${timeoutMs} ms`)), timeoutMs) }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
    await queue.close().catch(() => {})
  }
}

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
