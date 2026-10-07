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
/**
 * The status record the worker refreshes. It's kept for a week instead of expiring with the
 * heartbeat, so the Agents page can say when the worker was last seen and whether it stopped on
 * purpose, rather than just that it's gone.
 */
export const WORKER_STATUS_KEY = `${QUEUE_PREFIX}:factory-worker`
export const WORKER_STATUS_KEEP_SECONDS = 7 * 86_400
/**
 * How often the worker refreshes it. Kept well under a minute: Render's Key Value proxy has been
 * seen dropping a connection that went quiet for about a minute without telling the client, after
 * which every command on it waits forever (2026-10-07).
 */
export const WORKER_HEARTBEAT_MS = 30_000

/**
 * Set when the owner cancels a running request; the worker stops that request's run at its next
 * heartbeat. A queued request's job is just removed.
 */
export const cancelKey = (requestId: string) => `${QUEUE_PREFIX}:cancel:${requestId}`

export const JOB_NAMES = ['request', 'cycle', 'report', 'scout'] as const
export type FactoryJobName = typeof JOB_NAMES[number]
export type ScheduledJobName = Exclude<FactoryJobName, 'request'>

export interface RequestJobData {
  requestId: string
  /** Failed runs so far (the worker retries a request up to MAX_REQUEST_ATTEMPTS failures). */
  failures?: number
  /** The gate reason last written to the row, so a waiting request doesn't rewrite it every 15 min. */
  waitReason?: string
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

/**
 * Connection for the long-running worker: BullMQ requires maxRetriesPerRequest null for blocking
 * calls. TCP keepalive notices a connection whose other end is gone; a proxy that keeps the TCP
 * side open needs the worker's own timeouts (worker.ts heartbeat).
 */
export function workerConnection(url: string): ConnectionOptions {
  return { ...redisOptionsFromUrl(url), maxRetriesPerRequest: null, keepAlive: 30_000 }
}

function openQueue(url: string): Queue {
  const queue = new Queue(QUEUE_NAME, { connection: producerConnection(url), prefix: QUEUE_PREFIX })
  // Connection errors surface through the awaited calls; don't let them become unhandled events.
  queue.on('error', () => {})
  return queue
}

/** Rejects after `timeoutMs` so a slow Redis can't hold up a page, an action or the worker. */
export async function withinMs<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`Redis did not answer within ${timeoutMs} ms`)), timeoutMs) }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * Open the queue, run `fn`, close it. Writes (a request's job, Run now, pause, cancel) and
 * short-lived processes (the MCP server's calls, scripts) connect per call: a fresh connection is
 * the surer way to land a job, and closing it lets a script exit.
 */
export async function withQueue<T>(url: string, fn: (queue: Queue) => Promise<T>, timeoutMs = 8_000): Promise<T> {
  const queue = openQueue(url)
  try {
    return await withinMs(fn(queue), timeoutMs)
  } finally {
    await queue.close().catch(() => {})
  }
}

/** One queue per Redis URL per process, on globalThis so Next.js dev reloads reuse it too. */
function sharedQueues(): Map<string, { queue: Queue; usedAt: number }> {
  const g = globalThis as { __agentHqSharedQueues?: Map<string, { queue: Queue; usedAt: number }> }
  g.__agentHqSharedQueues ??= new Map()
  return g.__agentHqSharedQueues
}

/** A shared connection quiet for longer than this is reopened rather than trusted (WORKER_HEARTBEAT_MS). */
const SHARED_IDLE_MS = 45_000

/**
 * Like `withQueue`, but on a connection the process keeps: for reads a page repeats, like the
 * Agents page's poll (every 15 s per open tab; a new connection would cost a TLS handshake to
 * Render on every poll). Opened on first use, never at import (`next build` has no Redis). A call
 * that fails or times out drops it, since it may be half-open after the function was frozen or
 * still waiting on a Redis that's down, and the next call connects afresh. So does a connection
 * that sat idle past SHARED_IDLE_MS (the tab was closed), which Render's proxy may have dropped.
 */
export async function withSharedQueue<T>(url: string, fn: (queue: Queue) => Promise<T>, timeoutMs = 8_000): Promise<T> {
  const queues = sharedQueues()
  let entry = queues.get(url)
  if (entry && Date.now() - entry.usedAt > SHARED_IDLE_MS) {
    queues.delete(url)
    void entry.queue.close().catch(() => {})
    entry = undefined
  }
  if (!entry) {
    entry = { queue: openQueue(url), usedAt: Date.now() }
    queues.set(url, entry)
  }
  const { queue } = entry
  try {
    const result = await withinMs(fn(queue), timeoutMs)
    entry.usedAt = Date.now()
    return result
  } catch (err) {
    if (queues.get(url)?.queue === queue) queues.delete(url)
    await queue.close().catch(() => {})
    throw err
  }
}

export { parseWorkerStatus, type WorkerStatus } from './worker-state'
