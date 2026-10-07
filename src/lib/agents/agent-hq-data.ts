import 'server-only'

/**
 * What the Agents page shows (roadmap Phase 81, docs/agent-hq-migration-prd.md §9): the factory
 * worker's liveness, the BullMQ queue and its schedulers (Redis), and the requests, runs and
 * step traces (Neon). Owner-only data: callers check factoryAccess first.
 *
 * Redis is optional here. Without REDIS_URL, or when it doesn't answer, the panel still shows
 * everything Neon knows and says why the live parts are missing.
 */
import { and, desc, eq, inArray, isNotNull, isNull, or } from 'drizzle-orm'
import { db } from '@/lib/db'
import { agentJobs, agentRequests, automationRuns, repositories, traceEvents } from '@/lib/db/schema'
import { WORKER_STATUS_KEY, parseWorkerStatus, withQueue, type WorkerStatus } from '../../../factory/lib/queue'

export interface QueueSnapshot {
  waiting: number
  active: number
  delayed: number
  prioritized: number
  completed: number
  failed: number
  paused: boolean
}

export interface SchedulerInfo {
  name: string
  pattern: string | null
  tz: string | null
  /** ISO time of the next run, or null. */
  next: string | null
}

export interface ActiveJobInfo {
  id: string
  name: string
  /** Latest trace step the job reported (factory/lib/trace.ts → job.updateProgress). */
  progress: { step?: string; status?: string; detail?: string | null; at?: string } | null
}

export interface RunRow {
  id: string
  kind: string
  trigger: string
  status: string
  requestId: string | null
  startedAt: string
  finishedAt: string | null
  durationMs: number | null
  summary: Record<string, unknown> | null
  error: string | null
}

export interface RequestRow {
  id: string
  repo: string
  repoName: string
  mode: string
  skill: string | null
  objective: string
  source: string
  status: string
  prUrl: string | null
  findings: string | null
  reason: string | null
  attempts: number
  createdAt: string
  claimedAt: string | null
  resolvedAt: string | null
}

export interface AgentHqOverview {
  generatedAt: string
  redis: 'connected' | 'not-configured' | 'unreachable'
  redisError: string | null
  /** Null when Redis is unavailable or the worker's status key has expired (it's offline). */
  worker: WorkerStatus | null
  queue: QueueSnapshot | null
  activeJob: ActiveJobInfo | null
  schedulers: SchedulerInfo[]
  runs: RunRow[]
  requests: RequestRow[]
}

const iso = (d: Date | null) => (d ? d.toISOString() : null)

function toRunRow(r: typeof automationRuns.$inferSelect): RunRow {
  return {
    id: r.id, kind: r.kind, trigger: r.trigger, status: r.status, requestId: r.requestId,
    startedAt: r.startedAt.toISOString(), finishedAt: iso(r.finishedAt),
    durationMs: r.finishedAt ? r.finishedAt.getTime() - r.startedAt.getTime() : null,
    summary: (r.summary as Record<string, unknown> | null) ?? null, error: r.error,
  }
}

/** Runs the owner can see: the factory's (their user id) and the system-wide cron runs. */
const visibleRuns = (userId: string) => or(eq(automationRuns.userId, userId), isNull(automationRuns.userId))

async function liveQueue(): Promise<Pick<AgentHqOverview, 'redis' | 'redisError' | 'worker' | 'queue' | 'activeJob' | 'schedulers'>> {
  const url = process.env.REDIS_URL
  if (!url) return { redis: 'not-configured', redisError: null, worker: null, queue: null, activeJob: null, schedulers: [] }
  try {
    return await withQueue(url, async q => {
      const [counts, paused, schedulers, active, client] = await Promise.all([
        q.getJobCounts('waiting', 'active', 'delayed', 'prioritized', 'completed', 'failed'),
        q.isPaused(),
        q.getJobSchedulers(),
        q.getActive(0, 0),
        q.client,
      ])
      const job = active[0]
      return {
        redis: 'connected' as const,
        redisError: null,
        worker: parseWorkerStatus(await client.get(WORKER_STATUS_KEY)),
        queue: {
          waiting: counts.waiting ?? 0, active: counts.active ?? 0, delayed: counts.delayed ?? 0,
          prioritized: counts.prioritized ?? 0, completed: counts.completed ?? 0, failed: counts.failed ?? 0, paused,
        },
        activeJob: job ? { id: job.id ?? '', name: job.name, progress: typeof job.progress === 'object' ? (job.progress as ActiveJobInfo['progress']) : null } : null,
        schedulers: schedulers.map(s => ({
          name: s.name || s.key, pattern: s.pattern ?? null, tz: s.tz ?? null,
          next: s.next ? new Date(s.next).toISOString() : null,
        })),
      }
    })
  } catch (err) {
    return { redis: 'unreachable', redisError: err instanceof Error ? err.message : String(err), worker: null, queue: null, activeJob: null, schedulers: [] }
  }
}

export async function getAgentHqOverview(userId: string): Promise<AgentHqOverview> {
  const [live, runs, requests] = await Promise.all([
    liveQueue(),
    db.query.automationRuns.findMany({ where: visibleRuns(userId), orderBy: [desc(automationRuns.startedAt)], limit: 30 }),
    db.select({ r: agentRequests, repoName: repositories.name })
      .from(agentRequests)
      .leftJoin(repositories, eq(repositories.id, agentRequests.repoId))
      .where(eq(agentRequests.userId, userId))
      .orderBy(desc(agentRequests.createdAt))
      .limit(30),
  ])
  return {
    generatedAt: new Date().toISOString(),
    ...live,
    runs: runs.map(toRunRow),
    requests: requests.map(({ r, repoName }) => ({
      id: r.id, repo: r.repo, repoName: repoName ?? r.repo.split('/')[1] ?? r.repo, mode: r.mode, skill: r.skill,
      objective: r.objective, source: r.source, status: r.status, prUrl: r.prUrl, findings: r.findings, reason: r.reason,
      attempts: r.attempts, createdAt: r.createdAt.toISOString(), claimedAt: iso(r.claimedAt), resolvedAt: iso(r.resolvedAt),
    })),
  }
}

/** When the factory last finished any run (cycle, request, report, scout) — the freshness banner's input. */
export async function latestFactoryRunFinishedAt(userId: string): Promise<Date | null> {
  const [row] = await db.select({ finishedAt: automationRuns.finishedAt })
    .from(automationRuns)
    .where(and(eq(automationRuns.userId, userId), isNotNull(automationRuns.finishedAt)))
    .orderBy(desc(automationRuns.finishedAt))
    .limit(1)
  return row?.finishedAt ?? null
}

export interface TraceStep {
  id: number
  runId: string
  at: string
  step: string
  status: string
  detail: string | null
  data: Record<string, unknown> | null
  durationMs: number | null
  jobId: string | null
}

export interface AttemptRow {
  id: string
  tier: string
  model: string
  harness: string
  taskKind: string
  status: string
  reason: string | null
  prUrl: string | null
  adversaryVerdict: string | null
  requests: number | null
  durationMs: number | null
  startedAt: string
  parentJobId: string | null
}

export interface TraceView {
  runs: RunRow[]
  steps: TraceStep[]
  attempts: AttemptRow[]
}

/**
 * The step timeline for one request (every run that served it) or one run, with the tier
 * attempts (agent_jobs) those steps belong to. Null when it isn't the user's.
 */
export async function getTrace(userId: string, q: { requestId?: string; runId?: string }): Promise<TraceView | null> {
  let runs: (typeof automationRuns.$inferSelect)[] = []
  if (q.requestId) {
    const request = await db.query.agentRequests.findFirst({
      where: and(eq(agentRequests.id, q.requestId), eq(agentRequests.userId, userId)),
      columns: { id: true },
    })
    if (!request) return null
    runs = await db.query.automationRuns.findMany({
      where: and(eq(automationRuns.requestId, q.requestId), visibleRuns(userId)),
      orderBy: [desc(automationRuns.startedAt)],
      limit: 10,
    })
  } else if (q.runId) {
    const run = await db.query.automationRuns.findFirst({ where: and(eq(automationRuns.id, q.runId), visibleRuns(userId)) })
    if (!run) return null
    runs = [run]
  } else {
    return null
  }

  const runIds = runs.map(r => r.id)
  const steps = runIds.length > 0
    ? await db.query.traceEvents.findMany({
      where: inArray(traceEvents.runId, runIds),
      orderBy: (t, { asc }) => [asc(t.at), asc(t.id)],
      limit: 500,
    })
    : []
  const jobIds = [...new Set(steps.map(s => s.jobId).filter((x): x is string => !!x))]
  const attempts = q.requestId || jobIds.length > 0
    ? await db.query.agentJobs.findMany({
      where: and(
        eq(agentJobs.userId, userId),
        q.requestId
          ? (jobIds.length > 0 ? or(eq(agentJobs.requestId, q.requestId), inArray(agentJobs.id, jobIds)) : eq(agentJobs.requestId, q.requestId))
          : inArray(agentJobs.id, jobIds),
      ),
      orderBy: (j, { asc }) => [asc(j.startedAt)],
      limit: 50,
    })
    : []

  return {
    runs: runs.map(toRunRow),
    steps: steps.map(s => ({
      id: s.id, runId: s.runId, at: s.at.toISOString(), step: s.step, status: s.status, detail: s.detail,
      data: (s.data as Record<string, unknown> | null) ?? null, durationMs: s.durationMs, jobId: s.jobId,
    })),
    attempts: attempts.map(a => ({
      id: a.id, tier: a.tier, model: a.model, harness: a.harness, taskKind: a.taskKind, status: a.status, reason: a.reason,
      prUrl: a.prUrl, adversaryVerdict: a.adversaryVerdict, requests: a.requests, durationMs: a.durationMs,
      startedAt: a.startedAt.toISOString(), parentJobId: a.parentJobId,
    })),
  }
}
