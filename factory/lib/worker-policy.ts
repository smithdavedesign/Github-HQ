import type { FactoryJobName } from './queue'
import type { OwnerOutcome } from './owner-requests'
import type { RunResult } from './trace'

/**
 * Decisions the Agent HQ worker makes around each job (docs/agent-hq-migration-prd.md §6), kept
 * pure so they're unit-tested apart from BullMQ, Redis and the processes they gate.
 */

export interface HostState {
  /** ~/.repohq-factory/PAUSE exists. */
  pausedFile: boolean
  /** null = unknown (not macOS): treated as AC. */
  onAc: boolean | null
  /** FACTORY_REQUIRE_AC !== '0'. */
  requireAc: boolean
  /** Holder of factory.lock when another live process has it (a manual CLI run, the scout). */
  lockHolder: string | null
  /** null = not checked (sandbox off). */
  dockerUp: boolean | null
}

export type GateDecision =
  | { action: 'run' }
  | { action: 'skip'; reason: string }
  | { action: 'wait'; reason: string; delayMs: number }

const MIN = 60_000

/**
 * Whether a job may start now. `scheduled` = the job came from a job scheduler (not Run now, not a
 * request).
 *   PAUSE                → a scheduled job is skipped; Run now and requests wait 15 min (a paused
 *                          factory keeps its queue). Waiting scheduled jobs piled up: the scheduler
 *                          makes the next slot's job as soon as one starts, so a paused weekend
 *                          left ~26 cycles to run back to back on resume.
 *   lock held            → a scheduled cycle is skipped (another run has the repos); anything else
 *                          waits 5 min (concurrency 1 across worker and CLI).
 *   on battery           → a scheduled cycle is skipped (Night Shift v2: the Mac Deep-Idle-sleeps
 *                          mid-cycle on battery); a request waits 15 min; report/scout run.
 *   Docker down          → a cycle is skipped, a request waits 15 min (repo code never runs on the host).
 */
export function gateFor(job: FactoryJobName, s: HostState, scheduled = false): GateDecision {
  if (s.pausedFile) {
    const reason = 'paused (~/.repohq-factory/PAUSE exists)'
    return scheduled ? { action: 'skip', reason } : { action: 'wait', reason, delayMs: 15 * MIN }
  }
  if (s.lockHolder) {
    const reason = `another factory process is running (${s.lockHolder})`
    return scheduled && job === 'cycle' ? { action: 'skip', reason } : { action: 'wait', reason, delayMs: 5 * MIN }
  }
  const onBattery = s.requireAc && s.onAc === false
  if (job === 'cycle') {
    if (onBattery) return { action: 'skip', reason: 'on battery power (plug in for the night shift)' }
    if (s.dockerUp === false) return { action: 'skip', reason: 'Docker is not running (repo code never runs on the host)' }
  }
  if (job === 'request') {
    if (onBattery) return { action: 'wait', reason: 'waiting for AC power', delayMs: 15 * MIN }
    if (s.dockerUp === false) return { action: 'wait', reason: 'waiting for Docker (repo code never runs on the host)', delayMs: 15 * MIN }
  }
  return { action: 'run' }
}

/** A request is retried this many times after unexpected failures before it's marked failed. */
export const MAX_REQUEST_ATTEMPTS = 3

export type RequestFollowUp =
  | { action: 'done' }
  | { action: 'defer'; reason: string; delayMs: number; failures: number }
  | { action: 'fail'; reason: string }

/**
 * After a request's run: the row is the truth. Resolved → done. Still open → the run deferred or
 * skipped (wait and retry; not a failure), or it failed / ended without an outcome (retry until
 * MAX_REQUEST_ATTEMPTS failures, then mark the request failed with the reason).
 */
export function requestFollowUp(result: RunResult, rowStatus: string, priorFailures: number): RequestFollowUp {
  if (rowStatus !== 'queued' && rowStatus !== 'running') return { action: 'done' }
  if (result.status === 'deferred' || result.status === 'skipped') {
    return { action: 'defer', reason: result.reason ?? result.status, delayMs: (result.retryInMinutes ?? 15) * MIN, failures: priorFailures }
  }
  const reason = result.status === 'failed'
    ? (result.reason ?? 'the factory run failed')
    : 'the factory run ended without an outcome for this request'
  const failures = priorFailures + 1
  if (failures >= MAX_REQUEST_ATTEMPTS) return { action: 'fail', reason: `${reason} (after ${failures} attempts)` }
  return { action: 'defer', reason: `${reason} — retrying (${failures}/${MAX_REQUEST_ATTEMPTS})`, delayMs: 30 * MIN, failures }
}

const OUTCOME_STATUSES = new Set(['pr', 'verified', 'reported', 'rejected', 'failed'])

/**
 * The request outcome a run hands back in its result (run.ts `requestOutcome`), validated: the
 * worker writes it when the run's own write to the row didn't land.
 */
export function requestOutcomeOf(result: RunResult): OwnerOutcome | null {
  const o = result.summary?.requestOutcome as Partial<OwnerOutcome> | undefined
  if (!o || typeof o.status !== 'string' || !OUTCOME_STATUSES.has(o.status)) return null
  const text = (v: unknown) => typeof v === 'string' && v ? v : undefined
  return { status: o.status, ...(text(o.prUrl) ? { prUrl: text(o.prUrl) } : {}), ...(text(o.reason) ? { reason: text(o.reason) } : {}), ...(text(o.findings) ? { findings: text(o.findings) } : {}) }
}

/** automation_runs.status for a run result (a deferral didn't do the work: skipped). */
export function runStatusFor(result: RunResult): 'ok' | 'skipped' | 'failed' {
  return result.status === 'deferred' ? 'skipped' : result.status
}

/**
 * The command a job runs: the same entry points factory.sh used, under caffeinate on macOS.
 * `script` replaces the entry point (FACTORY_WORKER_CHILD; the flow tests' scripted stand-in for
 * run.ts, whose real pipeline needs Docker, LiteLLM and GitHub) and gets the job name first.
 */
export function childCommand(job: FactoryJobName, opts: { requestId?: string; platform: NodeJS.Platform; script?: string }): { cmd: string; args: string[] } {
  const script: Record<FactoryJobName, string[]> = {
    cycle: ['factory/run.ts', '--scheduled'],
    request: ['factory/run.ts', '--scheduled', `--request=${opts.requestId ?? ''}`],
    report: ['factory/report.ts'],
    scout: ['factory/scout.ts'],
  }
  const entry = opts.script ? [opts.script, job, ...script[job].slice(1)] : script[job]
  const tsx = ['npx', '--no-install', 'tsx', ...entry]
  // -i idle sleep, -m disk sleep, -s system sleep (only honoured on AC power), for this job only.
  return opts.platform === 'darwin' ? { cmd: 'caffeinate', args: ['-ims', ...tsx] } : { cmd: tsx[0], args: tsx.slice(1) }
}

/** Hard ceiling per job, after which the worker kills the run (the sandbox container lives ≤ 90 min). */
export const JOB_TIMEOUT_MS: Record<FactoryJobName, number> = {
  cycle: 3 * 60 * MIN,
  request: 2 * 60 * MIN,
  report: 30 * MIN,
  scout: 2 * 60 * MIN,
}

/**
 * Reconcile (Neon → Redis): which open requests need their job (re-)added. A job that's waiting,
 * delayed, active or prioritized is fine; a missing job, or a finished one for a row that's still
 * open, means it was lost (Redis flushed, enqueue failed, worker died) and is re-added.
 */
export function needsRequeue(jobState: string | null): boolean {
  return jobState === null || jobState === 'unknown' || jobState === 'completed' || jobState === 'failed'
}
