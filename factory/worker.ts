/**
 * Agent HQ factory worker (roadmap Phase 81, docs/agent-hq-migration-prd.md §6): the only
 * process that runs agents. It consumes the BullMQ queue RepoHQ writes to and runs every job
 * through the factory's one governed path (sandbox → tier ladder → judge → draft PR).
 *
 *   npm run factory:worker          # REDIS_URL + FACTORY_USER_ID in the environment
 *   bash factory/bin/factory.sh worker   # what launchd runs (KeepAlive), secrets from the keychain
 *
 * Jobs (factory/lib/queue.ts):
 *   request {requestId}  an agent_requests row: run.ts --request=<id> (owner task only)
 *   cycle / report / scout  scheduled work; job schedulers from factory.config.json `schedules`
 *                           replace the launchd calendar
 *
 * One job at a time (16 GB Mac: Docker VM + a resident 7B model). Each job runs as a child
 * process — the same entry points factory.sh used — so a crash can't take the worker down and
 * every run starts from clean module state. The child prints `::trace::` / `::result::` lines
 * (factory/lib/trace.ts): traces become live job progress, the result decides what happens to
 * the request. Neon is the truth for requests; Redis only carries ids, so on start (and after
 * every cycle) open requests whose job went missing are re-queued.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync } from 'node:fs'
import { hostname } from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'
import { DelayedError, Queue, UnrecoverableError, Worker, type Job } from 'bullmq'
import { isAllowlisted } from '../src/lib/agents/factory-request-utils'
import { claimRequest, deferRequest, failRequest, loadRequest, openRequests, resolveRequest, resolvedFromRow } from './lib/agent-requests'
import { loadConfig, type FactoryConfig } from './lib/config'
import { lockHolder } from './lib/lock'
import { run } from './lib/proc'
import {
  QUEUE_NAME, QUEUE_PREFIX, WORKER_HEARTBEAT_MS, cancelKey, WORKER_STATUS_KEEP_SECONDS, WORKER_STATUS_KEY, isFactoryJobName,
  parseWorkerStatus, requestJobOptions, scheduledJobTemplate, withinMs, workerConnection, type FactoryJobName,
  type RequestJobData, type ScheduledJobData, type ScheduledJobName, type WorkerStatus,
} from './lib/queue'
import { dockerAvailable } from './lib/sandbox'
import { finishRun, parseProtocolLine, pruneRuns, startRun, type RunKind, type RunResult } from './lib/trace'
import { HEARTBEAT_TIMEOUT_MS, configProblem, heartbeatAction, pickupCheck, recentStarts } from './lib/worker-health'
import { JOB_TIMEOUT_MS, childCommand, gateFor, needsRequeue, requestFollowUp, requestOutcomeOf, runStatusFor, type HostState } from './lib/worker-policy'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const SCHEDULED: ScheduledJobName[] = ['cycle', 'report', 'scout']
const schedulerId = (name: ScheduledJobName) => `factory-${name}`
const log = (...a: unknown[]) => console.log(`[worker ${new Date().toISOString().slice(11, 19)}]`, ...a)

const startedAt = new Date().toISOString()
let version: string | null = null
let active: { child: ChildProcess; job: Job; since: string } | null = null
let stopping = false
let docker: { up: boolean; at: number } | null = null
/** Status-record state (worker-health.ts): recent starts, a problem to report, the heartbeat's health. */
let starts: string[] = []
let problem: string | null = null
let heartbeatFailures = 0
let beating = false
let waitingSince: number | null = null
let lastStatus: WorkerStatus | null = null

async function main() {
  const url = process.env.REDIS_URL
  if (!url) throw new Error('REDIS_URL is not set (the agent-hq-redis Key Value from render.yaml; see factory/README.md "Worker")')
  const cfg = loadConfig()
  mkdirSync(path.join(cfg.home, 'logs'), { recursive: true })
  problem = configProblem(cfg.repohq)
  if (problem) log(`warning: ${problem}`)
  const rev = await run('git', ['-C', ROOT, 'rev-parse', '--short', 'HEAD'], { timeoutMs: 10_000 })
  version = rev.code === 0 ? rev.output.trim() : null

  const queue = new Queue(QUEUE_NAME, { connection: workerConnection(url), prefix: QUEUE_PREFIX })
  queue.on('error', err => log(`queue connection: ${err.message}`))
  // Status first, so even a worker that dies during setup shows up as one launchd keeps
  // restarting. A clean stop before this start (a reinstall, a reboot) isn't part of a loop.
  const previous = parseWorkerStatus(await withinMs(queue.client.then(c => c.get(WORKER_STATUS_KEY)), HEARTBEAT_TIMEOUT_MS).catch(() => null))
  starts = previous?.stoppedAt ? [startedAt] : recentStarts(previous?.starts, new Date(startedAt))
  await publishStatus(queue, cfg).catch(err => log(`status update failed: ${err instanceof Error ? err.message : err}`))
  await syncSchedulers(queue, cfg)
  await reconcileRequests(queue, cfg)

  const worker = new Worker(QUEUE_NAME, (job, token) => processJob(cfg, queue, job, token), {
    connection: workerConnection(url),
    prefix: QUEUE_PREFIX,
    concurrency: 1,
    name: `factory@${hostname()}`,
    // Jobs run for up to hours; BullMQ renews the lock while we wait on the child. A long lock
    // rides out short network blips; a dead worker's job is re-queued once (stalled detection).
    lockDuration: 10 * 60_000,
    maxStalledCount: 1,
  })
  worker.on('error', err => log(`worker connection: ${err.message}`))
  worker.on('failed', (job, err) => { if (!(err instanceof DelayedError)) log(`job ${job?.name} ${job?.id} failed: ${err.message}`) })

  const heartbeat = setInterval(() => { void beat(queue, cfg, restart) }, WORKER_HEARTBEAT_MS)
  log(`ready — queue "${QUEUE_NAME}" on ${new URL(url).hostname}, ${cfg.repos.length} repos allowlisted${version ? `, ${version}` : ''}`)

  // Close what can be closed; a stuck connection may never answer, so nothing here waits long.
  const stop = async (stoppedStatus: { stoppedAt: string; stopReason: string } | null) => {
    clearInterval(heartbeat)
    if (active?.child.pid) killGroup(active.child.pid, 'SIGTERM')
    await withinMs(worker.close(), 30_000).catch(() => {})
    if (stoppedStatus) await publishStopped(queue, stoppedStatus).catch(() => {})
    await withinMs(queue.close(), 5_000).catch(() => {})
  }
  // A clean stop (launchd at shutdown or reinstall, Ctrl-C) is recorded, so the Agents page says
  // the worker stopped instead of guessing.
  const shutdown = async (signal: string) => {
    if (stopping) return
    stopping = true
    log(`${signal} — stopping${active ? ` (interrupting ${active.job.name} ${active.job.id})` : ''}`)
    await stop({ stoppedAt: new Date().toISOString(), stopReason: signal })
    process.exit(0)
  }
  // The worker can't heal itself (worker-health.ts): exit for launchd to start a fresh one. Not
  // recorded as a stop; if it keeps happening, the start history shows the restart loop.
  async function restart(reason: string) {
    if (stopping) return
    stopping = true
    log(`restarting: ${reason}`)
    await stop(null)
    process.exit(1)
  }
  process.on('SIGTERM', () => { void shutdown('SIGTERM') })
  process.on('SIGINT', () => { void shutdown('SIGINT') })
}

/**
 * One heartbeat: refresh the status record within HEARTBEAT_TIMEOUT_MS, then check that queued
 * jobs are being taken. A failed write reconnects the status connection (a command still waiting
 * on the dead one is resent on the new one); five in a row on an idle worker restart it.
 */
async function beat(queue: Queue, cfg: FactoryConfig, restart: (reason: string) => Promise<void>): Promise<void> {
  if (beating || stopping) return
  beating = true
  try {
    try {
      await publishStatus(queue, cfg)
      if (heartbeatFailures > 0) log(`status updates recovered after ${heartbeatFailures} failure(s)`)
      heartbeatFailures = 0
    } catch (err) {
      heartbeatFailures++
      const action = heartbeatAction(heartbeatFailures, !!active)
      log(`status update failed (${heartbeatFailures} in a row): ${err instanceof Error ? err.message : err} — ${action === 'exit' ? 'restarting the worker' : 'reconnecting'}`)
      if (action === 'exit') return await restart(`Redis stopped answering status updates ${heartbeatFailures} times in a row`)
      await queue.client.then(c => c.disconnect(true)).catch(() => {})
      return
    }
    // A request cancelled while running: stop its run (the cancelled row keeps the result out).
    if (active?.job.name === 'request') {
      const id = (active.job.data as RequestJobData).requestId
      const client = await queue.client
      if (await withinMs(client.get(cancelKey(id)), HEARTBEAT_TIMEOUT_MS) && active.child.pid) {
        log(`request ${id}: cancelled from the Agents page — stopping its run`)
        killGroup(active.child.pid, 'SIGTERM')
        await withinMs(client.del(cancelKey(id)), HEARTBEAT_TIMEOUT_MS).catch(() => {})
      }
    }
    if (active || await withinMs(queue.isPaused(), HEARTBEAT_TIMEOUT_MS)) { waitingSince = null; return }
    const counts = await withinMs(queue.getJobCounts('waiting', 'prioritized', 'active'), HEARTBEAT_TIMEOUT_MS)
    const check = pickupCheck({ waiting: (counts.waiting ?? 0) + (counts.prioritized ?? 0), active: counts.active ?? 0 }, waitingSince, Date.now())
    waitingSince = check.waitingSince
    if (check.stuck) await restart('jobs have been waiting 10+ minutes and the worker isn\'t taking them')
  } catch (err) {
    log(`queue check failed: ${err instanceof Error ? err.message : err}`)
  } finally {
    beating = false
  }
}

/** Job schedulers = config (factory.config.json `schedules`), in this machine's time zone. */
async function syncSchedulers(queue: Queue, cfg: FactoryConfig): Promise<void> {
  const tz = process.env.TZ || Intl.DateTimeFormat().resolvedOptions().timeZone
  for (const name of SCHEDULED) {
    const pattern = cfg.schedules[name]
    if (pattern) await queue.upsertJobScheduler(schedulerId(name), { pattern, tz }, scheduledJobTemplate(name))
    else await queue.removeJobScheduler(schedulerId(name))
  }
  const known = new Set(SCHEDULED.map(schedulerId))
  for (const s of await queue.getJobSchedulers()) {
    if (!known.has(s.key)) await queue.removeJobScheduler(s.key)
  }
  log(`schedules (${tz}): ${SCHEDULED.map(n => `${n} "${cfg.schedules[n] ?? 'off'}"`).join(' · ')}`)
}

/** Neon → Redis: re-add the job of every open request whose job is missing or already finished. */
async function reconcileRequests(queue: Queue, cfg: FactoryConfig): Promise<void> {
  for (const row of await openRequests(cfg)) {
    const job = await queue.getJob(row.id)
    const state = job ? await job.getState() : null
    if (!needsRequeue(state)) continue
    if (job) await job.remove().catch(() => {})
    await queue.add('request', { requestId: row.id } satisfies RequestJobData, requestJobOptions(row.id))
    log(`reconcile: re-queued request ${row.id} (${row.repo}; job was ${state ?? 'missing'})`)
  }
}

async function processJob(cfg: FactoryConfig, queue: Queue, job: Job, token?: string): Promise<RunResult> {
  if (!isFactoryJobName(job.name)) throw new UnrecoverableError(`unknown job "${job.name}"`)
  const name = job.name
  const gate = gateFor(name, await hostState(cfg, name), name !== 'request' && triggerOf(job) === 'schedule')
  if (gate.action === 'wait') {
    log(`${name} ${job.id}: ${gate.reason} — retrying in ${Math.round(gate.delayMs / 60_000)} min`)
    // The row shows why it waits. Written once per reason, not every 15 minutes: a request
    // waiting days for the Mac would otherwise keep Neon's compute awake.
    const data = job.data as RequestJobData
    if (name === 'request' && data.waitReason !== gate.reason) {
      await deferRequest(cfg, data.requestId, gate.reason, new Date())
      await job.updateData({ ...data, waitReason: gate.reason })
    }
    await job.moveToDelayed(Date.now() + gate.delayMs, token)
    throw new DelayedError()
  }
  if (gate.action === 'skip') {
    // Recorded so the Agents page shows the slot was reached and why nothing ran.
    const id = randomUUID()
    await startRun(cfg, { id, kind: `factory-${name}` as RunKind, trigger: triggerOf(job), jobId: job.id ?? null }, new Date())
    await finishRun(cfg, id, { status: 'skipped', summary: { reason: gate.reason } }, new Date())
    log(`${name} ${job.id}: skipped — ${gate.reason}`)
    return { status: 'skipped', reason: gate.reason }
  }
  return name === 'request' ? processRequest(cfg, queue, job, token) : processScheduled(cfg, queue, job, name)
}

async function processScheduled(cfg: FactoryConfig, queue: Queue, job: Job, name: ScheduledJobName): Promise<RunResult> {
  const runId = randomUUID()
  await startRun(cfg, { id: runId, kind: `factory-${name}` as RunKind, trigger: triggerOf(job), jobId: job.id ?? null }, new Date())
  const result = await runChild(cfg, job, name, runId)
  await finishRun(cfg, runId, {
    status: runStatusFor(result),
    summary: { ...result.summary, ...(result.reason ? { reason: result.reason } : {}) },
    ...(result.status === 'failed' ? { error: result.reason } : {}),
  }, new Date())
  log(`${name} ${job.id}: ${result.status}${result.reason ? ` — ${result.reason}` : ''}`)
  // Cycles touch Neon anyway: piggyback the reconcile there instead of polling it on a timer.
  if (name === 'cycle') await reconcileRequests(queue, cfg)
  if (name === 'report') await pruneRuns(cfg, new Date())
  return result
}

async function processRequest(cfg: FactoryConfig, queue: Queue, job: Job, token?: string): Promise<RunResult> {
  const data = job.data as RequestJobData
  let row: Awaited<ReturnType<typeof claimRequest>>
  try {
    row = await claimRequest(cfg, data.requestId, new Date())
  } catch (err) {
    log(`request ${data.requestId}: can't reach Neon (${err instanceof Error ? err.message : err}) — retrying in 15 min`)
    await job.moveToDelayed(Date.now() + 15 * 60_000, token)
    throw new DelayedError()
  }
  if (!row) return { status: 'skipped', reason: 'request is no longer open (cancelled or already resolved)' }
  if (!isAllowlisted(row.repo, cfg.repos)) {
    const reason = `${row.repo} is not on the factory allowlist (factory/factory.config.json "repos")`
    await resolveRequest(cfg, resolvedFromRow(row), { status: 'rejected', reason }, 'worker', new Date())
    return { status: 'ok', reason }
  }

  const runId = randomUUID()
  await startRun(cfg, { id: runId, kind: 'factory-request', trigger: 'request', requestId: row.id, jobId: job.id ?? null }, new Date())
  log(`request ${row.id}: ${row.mode} on ${row.repo}${row.skill ? ` (/${row.skill})` : ''}, pickup ${row.attempts}`)
  const result = await runChild(cfg, job, 'request', runId, row.id)
  let after = await loadRequest(cfg, row.id).catch(() => null)
  // The run reached an outcome but its write to the row didn't land: write it here, don't re-run.
  const handed = requestOutcomeOf(result)
  if (handed && after && (after.status === 'running' || after.status === 'queued')) {
    log(`request ${row.id}: the run's outcome (${handed.status}) wasn't saved — writing it from the worker`)
    await resolveRequest(cfg, resolvedFromRow(row), handed, runId, new Date())
    after = await loadRequest(cfg, row.id).catch(() => after)
  }
  const follow = stopping
    ? { action: 'defer' as const, reason: 'the worker restarted mid-run — retrying', delayMs: 60_000, failures: data.failures ?? 0 }
    : requestFollowUp(result, after?.status ?? 'running', data.failures ?? 0)
  // The handed-over outcome is in the request row; the run summary keeps the counts.
  const { requestOutcome: _handed, ...summary } = result.summary ?? {}
  await finishRun(cfg, runId, {
    status: runStatusFor(result),
    summary: { ...summary, requestStatus: after?.status ?? null, ...(result.reason ? { reason: result.reason } : {}) },
    ...(result.status === 'failed' ? { error: result.reason } : {}),
  }, new Date())
  log(`request ${row.id}: run ${result.status}, request ${after?.status ?? 'unknown'}${follow.action !== 'done' ? ` → ${follow.action}: ${follow.reason}` : ''}`)

  if (follow.action === 'fail') await failRequest(cfg, resolvedFromRow(row), follow.reason, runId, new Date())
  if (follow.action === 'defer') {
    await deferRequest(cfg, row.id, follow.reason, new Date())
    if (follow.failures !== (data.failures ?? 0)) await job.updateData({ ...data, failures: follow.failures })
    await job.moveToDelayed(Date.now() + follow.delayMs, token)
    throw new DelayedError()
  }
  return { ...result, summary: { ...summary, requestStatus: after?.status ?? null } }
}

/** Run one job's entry point as a child process; its stdout protocol lines become job progress. */
async function runChild(cfg: FactoryConfig, job: Job, name: FactoryJobName, runId: string, requestId?: string): Promise<RunResult> {
  const { cmd, args } = childCommand(name, { requestId, platform: process.platform, script: process.env.FACTORY_WORKER_CHILD || undefined })
  const logFile = path.join(cfg.home, 'logs', `${name}-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}-${runId.slice(0, 8)}.log`)
  const out = createWriteStream(logFile, { flags: 'a' })
  out.write(`=== ${name} ${new Date().toISOString()} run ${runId}${requestId ? ` request ${requestId}` : ''} ===\n`)
  const child = spawn(cmd, args, {
    cwd: ROOT,
    // The child inherits the worker's environment (DB URL, user id, budget); repo code never
    // sees it — the sandbox passes only per-command overrides into its container (Phase 76).
    env: { ...process.env, FACTORY_AUTOMATION_RUN_ID: runId },
    stdio: ['ignore', 'pipe', 'pipe'],
    // Own process group, so a timeout or shutdown stops caffeinate → npx → tsx → node together.
    detached: true,
  })
  active = { child, job, since: new Date().toISOString() }
  let result: RunResult | null = null
  const onLine = (line: string) => {
    out.write(`${line}\n`)
    const p = parseProtocolLine(line)
    if (!p) return
    if (p.kind === 'result') { result = p.value; return }
    const t = p.value
    void job.updateProgress({ step: t.step, status: t.status, detail: t.detail ?? null, at: t.at }).catch(() => {})
    void job.log(`${t.status.padEnd(5)} ${t.step}${t.detail ? ` — ${t.detail}` : ''}`).catch(() => {})
  }
  createInterface({ input: child.stdout! }).on('line', onLine)
  createInterface({ input: child.stderr! }).on('line', line => out.write(`${line}\n`))

  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    log(`${name} ${job.id}: over ${JOB_TIMEOUT_MS[name] / 60_000} min — stopping it`)
    if (child.pid) killGroup(child.pid, 'SIGTERM')
    setTimeout(() => { if (child.pid && child.exitCode === null) killGroup(child.pid, 'SIGKILL') }, 30_000).unref()
  }, JOB_TIMEOUT_MS[name])
  const code = await new Promise<number | null>(resolve => {
    child.on('error', err => { out.write(`spawn failed: ${err.message}\n`); resolve(null) })
    child.on('close', c => resolve(c))
  })
  clearTimeout(timer)
  active = null
  out.write(`=== exit ${code} ===\n`)
  out.end()
  const reported = result as RunResult | null
  if (reported && !timedOut) return reported
  if (timedOut) return { status: 'failed', reason: `timed out after ${JOB_TIMEOUT_MS[name] / 60_000} min (log: ${logFile})` }
  return code === 0 ? { status: 'ok' } : { status: 'failed', reason: `exited ${code ?? 'abnormally'} (log: ${logFile})` }
}

function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal)
  } catch {
    try { process.kill(pid, signal) } catch { /* already gone */ }
  }
}

function triggerOf(job: Job): 'schedule' | 'manual' {
  return (job.data as ScheduledJobData | undefined)?.trigger === 'manual' ? 'manual' : 'schedule'
}

async function onAcPower(): Promise<boolean | null> {
  if (process.platform !== 'darwin') return null
  const r = await run('pmset', ['-g', 'batt'], { timeoutMs: 10_000 })
  return r.code === 0 ? !/Battery Power/.test(r.output) : null
}

/** Docker's state, cached for a minute (`docker info` is slow when Docker Desktop is starting). */
async function dockerUp(cfg: FactoryConfig): Promise<boolean | null> {
  if (cfg.sandbox.mode !== 'docker') return null
  if (!docker || Date.now() - docker.at > 60_000) docker = { up: await dockerAvailable(), at: Date.now() }
  return docker.up
}

async function hostState(cfg: FactoryConfig, job: FactoryJobName): Promise<HostState> {
  const needsDocker = job === 'cycle' || job === 'request'
  return {
    pausedFile: existsSync(path.join(cfg.home, 'PAUSE')),
    onAc: await onAcPower(),
    requireAc: process.env.FACTORY_REQUIRE_AC !== '0',
    lockHolder: lockHolder(cfg.home),
    dockerUp: needsDocker ? await dockerUp(cfg) : null,
  }
}

/**
 * The status record the Agents page reads (factory/lib/worker-state.ts). Only the Redis write is
 * timed: the local probes (pmset, docker info) can be slow on a busy Mac, and that isn't a Redis
 * problem worth reconnecting over. Throws when the write fails or times out.
 */
async function publishStatus(queue: Queue, cfg: FactoryConfig): Promise<void> {
  const status: WorkerStatus = {
    host: hostname(), pid: process.pid, startedAt, lastSeenAt: new Date().toISOString(),
    pausedFile: existsSync(path.join(cfg.home, 'PAUSE')), onAc: await onAcPower(), dockerUp: await dockerUp(cfg),
    version, activeJob: active ? { id: active.job.id ?? '', name: active.job.name, since: active.since } : null,
    problem, starts, stoppedAt: null, stopReason: null,
  }
  await writeStatus(queue, status, HEARTBEAT_TIMEOUT_MS)
  lastStatus = status
}

/** A clean stop: the last status, marked stopped, without probing again (launchd gives ~20 s). */
async function publishStopped(queue: Queue, stopped: { stoppedAt: string; stopReason: string }): Promise<void> {
  if (!lastStatus) return
  await writeStatus(queue, { ...lastStatus, lastSeenAt: stopped.stoppedAt, activeJob: null, ...stopped }, 5_000)
}

async function writeStatus(queue: Queue, status: WorkerStatus, timeoutMs: number): Promise<void> {
  const client = await queue.client
  await withinMs(client.set(WORKER_STATUS_KEY, JSON.stringify(status), { EX: WORKER_STATUS_KEEP_SECONDS }), timeoutMs)
}

main().catch(err => {
  console.error('[worker] failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
