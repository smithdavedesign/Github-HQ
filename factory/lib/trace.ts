import { eq, lt } from 'drizzle-orm'
import * as schema from '../../src/lib/db/schema'
import type { FactoryConfig } from './config'
import { safely, sinkDb } from './sink'

/**
 * Agent HQ tracing (roadmap Phase 81, docs/agent-hq-migration-prd.md §5, §9): every automated run
 * is an `automation_runs` row and every step a `trace_events` row, so the Agents page can show
 * what a run did and where it stopped. Like the rest of the sink, nothing here throws: the
 * ledger stays the factory's source of truth and a Neon hiccup must never fail a cycle.
 *
 * A run also prints each step on stdout as one `::trace::{json}` line and finishes with one
 * `::result::{json}` line. The worker (factory/worker.ts) spawns cycles as child processes and
 * reads these lines for live job progress and the run's outcome.
 */

export type TraceStatus = 'start' | 'ok' | 'fail' | 'info'

export interface TraceLine {
  at: string
  step: string
  status: TraceStatus
  detail?: string
  data?: Record<string, unknown>
  durationMs?: number
  /** agent_jobs.id (ledger attempt id) the step belongs to. */
  jobId?: string
  requestId?: string
}

/** How a run ended, as the worker understands it. */
export interface RunResult {
  /** ok = did its work · skipped = nothing ran (paused, gate, refusal) · deferred = try later · failed = error */
  status: 'ok' | 'skipped' | 'deferred' | 'failed'
  reason?: string
  /** Minutes until a deferred request is worth retrying (free quota, daily PR cap). */
  retryInMinutes?: number
  summary?: Record<string, unknown>
}

export const TRACE_PREFIX = '::trace::'
export const RESULT_PREFIX = '::result::'
const MAX_DETAIL = 1_000

export function formatProtocolLine(prefix: typeof TRACE_PREFIX | typeof RESULT_PREFIX, value: TraceLine | RunResult): string {
  return `${prefix}${JSON.stringify(value)}`
}

/** One stdout line from a factory child process: a trace step, the run result, or plain log text. */
export function parseProtocolLine(line: string): { kind: 'trace'; value: TraceLine } | { kind: 'result'; value: RunResult } | null {
  const text = line.trim()
  const kind = text.startsWith(TRACE_PREFIX) ? 'trace' : text.startsWith(RESULT_PREFIX) ? 'result' : null
  if (!kind) return null
  try {
    const value = JSON.parse(text.slice(kind === 'trace' ? TRACE_PREFIX.length : RESULT_PREFIX.length))
    if (kind === 'trace' && typeof value?.step === 'string' && typeof value?.status === 'string') return { kind, value }
    if (kind === 'result' && typeof value?.status === 'string') return { kind, value }
  } catch {
    // not ours
  }
  return null
}

/** Records the steps of one run (stdout always; Neon when the sink is configured and a run id is set). */
export class Tracer {
  private chain: Promise<void> = Promise.resolve()

  constructor(
    private readonly cfg: FactoryConfig | null,
    /** automation_runs.id; null = stdout only. */
    readonly runId: string | null,
    public requestId: string | null = null,
    private readonly out: (line: string) => void = line => console.log(line),
  ) {}

  step(step: string, status: TraceStatus, detail?: string, data?: Record<string, unknown>, extra: { durationMs?: number; jobId?: string } = {}): void {
    const line: TraceLine = {
      at: new Date().toISOString(), step, status,
      ...(detail ? { detail: detail.slice(0, MAX_DETAIL) } : {}),
      ...(data ? { data } : {}),
      ...(extra.durationMs !== undefined ? { durationMs: Math.round(extra.durationMs) } : {}),
      ...(extra.jobId ? { jobId: extra.jobId } : {}),
      ...(this.requestId ? { requestId: this.requestId } : {}),
    }
    this.out(formatProtocolLine(TRACE_PREFIX, line))
    const cfg = this.cfg
    const runId = this.runId
    if (!cfg || !runId) return
    // Serialised so the timeline keeps its order; failures are logged by `safely` and dropped.
    this.chain = this.chain.then(() => insertTrace(cfg, runId, line))
  }

  /** start → ok/fail with the duration; rethrows after recording a failure. */
  async span<T>(step: string, fn: () => Promise<T>, describe?: (result: T) => { status?: TraceStatus; detail?: string; data?: Record<string, unknown> }, jobId?: string): Promise<T> {
    const t0 = Date.now()
    this.step(step, 'start', undefined, undefined, { jobId })
    try {
      const result = await fn()
      const d = describe?.(result)
      this.step(step, d?.status ?? 'ok', d?.detail, d?.data, { durationMs: Date.now() - t0, jobId })
      return result
    } catch (err) {
      this.step(step, 'fail', err instanceof Error ? err.message : String(err), undefined, { durationMs: Date.now() - t0, jobId })
      throw err
    }
  }

  /** Wait for queued Neon writes (call before the process exits). */
  flush(): Promise<void> {
    return this.chain
  }
}

async function insertTrace(cfg: FactoryConfig, runId: string, line: TraceLine): Promise<void> {
  const d = sinkDb(cfg)
  if (!d) return
  await safely('trace', async () => {
    await d.insert(schema.traceEvents).values({
      runId, requestId: line.requestId ?? null, jobId: line.jobId ?? null, at: new Date(line.at),
      step: line.step, status: line.status, detail: line.detail ?? null, data: line.data ?? null, durationMs: line.durationMs ?? null,
    })
  })
}

export type RunKind = 'factory-cycle' | 'factory-request' | 'factory-report' | 'factory-scout'

/** Open an automation_runs row. Returns false when the sink isn't configured or the write failed. */
export async function startRun(
  cfg: FactoryConfig,
  r: { id: string; kind: RunKind; trigger: 'schedule' | 'manual' | 'request'; requestId?: string | null; jobId?: string | null },
  now: Date,
): Promise<boolean> {
  const d = sinkDb(cfg)
  if (!d) return false
  let ok = false
  await safely('startRun', async () => {
    await d.insert(schema.automationRuns).values({
      id: r.id, userId: cfg.repohq.userId, kind: r.kind, trigger: r.trigger, requestId: r.requestId ?? null,
      jobId: r.jobId ?? null, status: 'running', startedAt: now,
    }).onConflictDoNothing()
    ok = true
  })
  return ok
}

export async function finishRun(cfg: FactoryConfig, id: string, r: { status: 'ok' | 'skipped' | 'failed'; summary?: Record<string, unknown>; error?: string }, now: Date): Promise<void> {
  const d = sinkDb(cfg)
  if (!d) return
  await safely('finishRun', async () => {
    await d.update(schema.automationRuns)
      .set({ status: r.status, summary: r.summary ?? null, error: r.error?.slice(0, 2_000) ?? null, finishedAt: now })
      .where(eq(schema.automationRuns.id, id))
  })
}

/** Retention (PRD §5): drop runs older than `days`; their trace events go with them (cascade). */
export async function pruneRuns(cfg: FactoryConfig, now: Date, days = 90): Promise<void> {
  const d = sinkDb(cfg)
  if (!d) return
  await safely('pruneRuns', async () => {
    await d.delete(schema.automationRuns).where(lt(schema.automationRuns.startedAt, new Date(now.getTime() - days * 86_400_000)))
  })
}
