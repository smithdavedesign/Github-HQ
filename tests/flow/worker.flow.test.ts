/**
 * The whole Agent HQ flow (roadmap Phase 81, docs/agent-hq-migration-prd.md §6–§9) with the real
 * worker: RepoHQ queues a request → BullMQ on Redis → factory/worker.ts claims it, gates it and
 * spawns the job → the job traces its steps and resolves the request → Neon rows, events,
 * notifications, the status API and the Agents page data all agree.
 *
 * The job is tests/flow/fixtures/fake-run.ts (FACTORY_WORKER_CHILD): run.ts's real pipeline needs
 * Docker, LiteLLM and GitHub. Everything else is production code. The last block runs the real
 * run.ts as the child, as far as this machine allows (it refuses to run unsandboxed).
 */
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { Job, Queue } from 'bullmq'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  FLOW, closePools, createDatabase, factoryHome, flowEnv, flowQueue, neonUrl, q, requestRow, resetRedis, seed,
  startWorker, waitFor, waitForRequest, workerStatusRaw, type Seeded, type WorkerHandle,
} from './harness/flow'
import { FLOW_DEFER_REASON, FLOW_FAIL_REASON, FLOW_FINDINGS, FLOW_FINDING_LINES, FLOW_PR_URL, objective } from './harness/scenarios'
import { parseWorkerStatus, requestJobOptions } from '../../factory/lib/queue'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
const { auth } = await import('@/lib/auth')
const { queueGstackSkill } = await import('@/lib/actions/agent-queue')
const { cancelRequest, runNow, setQueuePaused } = await import('@/lib/actions/automation')
const { getAgentHqOverview, getTrace } = await import('@/lib/agents/agent-hq-data')
const { getRepoLifecycle } = await import('@/lib/agents/lifecycle')
const taskStatus = await import('@/app/api/agent-task-status/route')

const DB = 'agent_hq_flow_worker'
let s: Seeded
let queue: Queue
let worker: WorkerHandle
let home: { home: string; config: string }
let orphanId: string

async function status(taskId: string) {
  const res = await taskStatus.GET(new Request(`http://flow.test/api/agent-task-status?taskId=${taskId}`))
  return await res.json() as Record<string, unknown>
}

async function launch(skill: Parameters<typeof queueGstackSkill>[1], text: string): Promise<string> {
  return (await queueGstackSkill(s.repoId, skill, text)).taskId
}

async function runsFor(requestId: string) {
  return q<{ id: string; kind: string; trigger: string; status: string; job_id: string | null; summary: Record<string, unknown> | null; error: string | null; finished_at: Date | null }>(
    DB, 'SELECT id, kind, trigger, status, job_id, summary, error, finished_at FROM automation_runs WHERE request_id = $1 ORDER BY started_at', [requestId])
}

async function stepsFor(runId: string) {
  return q<{ step: string; status: string; request_id: string | null; job_id: string | null; duration_ms: number | null; detail: string | null }>(
    DB, 'SELECT step, status, request_id, job_id, duration_ms, detail FROM trace_events WHERE run_id = $1 ORDER BY at, id', [runId])
}

async function eventsFor(requestId: string) {
  return q<{ event_type: string; metadata: Record<string, unknown>; repo_id: number | null }>(
    DB, `SELECT event_type, metadata, repo_id FROM portfolio_events WHERE metadata->>'taskId' = $1 ORDER BY occurred_at, id`, [requestId])
}

async function notificationsFor(requestId: string) {
  return q<{ event_type: string; title: string }>(DB, `SELECT event_type, title FROM notifications WHERE metadata->>'taskId' = $1`, [requestId])
}

/** The job, once the worker has put it back as delayed (a deferral or a retry). */
function delayedJob(requestId: string): Promise<Job> {
  return waitFor(async () => {
    const job = await queue.getJob(requestId)
    return job && (await job.getState()) === 'delayed' ? job : null
  }, `job ${requestId} delayed`)
}

/**
 * The job resolves the request row itself; the worker closes the automation run and completes
 * the BullMQ job just after. Wait for those too before asserting on them (CI is slow enough to
 * read in between).
 */
function settled(requestId: string): Promise<true> {
  return waitFor(async () => {
    const job = await queue.getJob(requestId)
    if (!job || (await job.getState()) !== 'completed') return null
    return (await runsFor(requestId)).every(r => r.status !== 'running') || null
  }, `job ${requestId} settled`)
}

/** Let a delayed job run now instead of in 15–30 minutes. */
async function promote(requestId: string): Promise<void> {
  await (await delayedJob(requestId)).promote()
}

beforeAll(async () => {
  await createDatabase(DB)
  s = await seed(DB)
  await resetRedis()
  process.env.DATABASE_URL = neonUrl(DB)
  process.env.REDIS_URL = FLOW.redisUrl
  process.env.FACTORY_USER_ID = FLOW.ownerId
  queue = flowQueue()
  // A request whose job never reached Redis (enqueue failed): the worker must find it on start.
  orphanId = 'flow-orphan-request'
  await q(DB, `INSERT INTO agent_requests (id, user_id, repo_id, repo, mode, skill, objective, source) VALUES ($1, $2, $3, $4, 'report', 'health', $5, 'ui-skill')`,
    [orphanId, FLOW.ownerId, s.repoId, FLOW.allowlistedRepo, objective('Queued while Redis was down', 'report')])
  home = factoryHome()
  worker = await startWorker(flowEnv(DB, home))
})

afterAll(async () => {
  await worker?.stop()
  await queue?.close()
  await closePools()
  if (home) rmSync(home.home, { recursive: true, force: true })
})

beforeEach(() => {
  vi.mocked(auth).mockResolvedValue({ user: { id: FLOW.ownerId }, expires: '' } as never)
})

describe('worker start', () => {
  it('registers the schedules from factory.config.json in its time zone (they replace the launchd calendar)', async () => {
    const schedulers = await queue.getJobSchedulers()
    expect(schedulers.map(x => ({ key: x.key, pattern: x.pattern, tz: x.tz })).sort((a, b) => a.key.localeCompare(b.key))).toEqual([
      { key: 'factory-cycle', pattern: '0 3 29 2 *', tz: 'America/Los_Angeles' },
      { key: 'factory-report', pattern: '45 6 29 2 *', tz: 'America/Los_Angeles' },
      { key: 'factory-scout', pattern: '10 17 29 2 *', tz: 'America/Los_Angeles' },
    ])
  })

  it('publishes a heartbeat the Agents page reads', async () => {
    const status = parseWorkerStatus(await workerStatusRaw())
    expect(status).toMatchObject({ pid: worker.child.pid, pausedFile: false, dockerUp: null, problem: null, stoppedAt: null, starts: [status!.startedAt] })
    expect(status!.host).toBeTruthy()
    expect(Date.now() - new Date(status!.lastSeenAt).getTime()).toBeLessThan(120_000)
  })

  it('re-queues a request whose job never reached Redis, and runs it', async () => {
    await worker.waitForLog(new RegExp(`reconcile: re-queued request ${orphanId}`))
    expect(await waitForRequest(DB, orphanId, ['reported'])).toMatchObject({ attempts: 1 })
  })
})

describe('a report request, end to end', () => {
  let id: string

  it('runs: queued → running → reported, with the findings on the row', async () => {
    id = await launch('health', objective('Score the code health', 'report'))
    const row = await waitForRequest(DB, id, ['reported'])
    expect(row).toMatchObject({ status: 'reported', findings: FLOW_FINDINGS, attempts: 1, reason: null })
    expect(row.claimed_at).toBeInstanceOf(Date)
    expect(row.resolved_at!.getTime()).toBeGreaterThanOrEqual(row.claimed_at!.getTime())
    // UTC wall time all the way through: not hours off in a non-UTC zone.
    expect(Math.abs(row.resolved_at!.getTime() - Date.now())).toBeLessThan(60_000)
    await settled(id)
  })

  it('is one automation run with the step timeline, every step tagged with the request', async () => {
    const [run] = await runsFor(id)
    expect(run).toMatchObject({ kind: 'factory-request', trigger: 'request', status: 'ok', job_id: id, error: null, finished_at: expect.any(Date) })
    expect(run.summary).toMatchObject({ requestStatus: 'reported' })
    const steps = await stepsFor(run.id)
    expect(steps.map(x => `${x.step}:${x.status}`)).toEqual([
      'request:info', 'clone:start', 'clone:ok', 'install:start', 'install:ok', 'checks:start', 'checks:ok', 'report:start', 'report:ok', 'request:ok',
    ])
    expect(steps.every(x => x.request_id === id)).toBe(true)
    expect(steps.filter(x => x.status === 'ok' && x.step !== 'request').every(x => typeof x.duration_ms === 'number')).toBe(true)
  })

  it('writes the agent_skill_report event the findings preview and MCP read; no notification', async () => {
    const events = await eventsFor(id)
    expect(events.map(e => e.event_type)).toEqual(['agent_task_queued', 'agent_skill_report'])
    expect(events[1]).toMatchObject({ repo_id: s.repoId, metadata: expect.objectContaining({ taskId: id, executor: 'factory', skillName: 'health', findings: FLOW_FINDING_LINES, outcome: 'no-changes' }) })
    expect(await notificationsFor(id)).toEqual([])
  })

  it('the BullMQ job completed with the run result, its progress and its log', async () => {
    const job = (await queue.getJob(id))!
    expect(await job.getState()).toBe('completed')
    expect(job.returnvalue).toMatchObject({ status: 'ok', summary: { requestStatus: 'reported' } })
    expect(job.progress).toMatchObject({ step: 'request', status: 'ok' })
    const { logs } = await queue.getJobLogs(id)
    expect(logs.some(l => /checks — typecheck · lint · test/.test(l))).toBe(true)
  })

  it('the status API, the trace view and the lifecycle agree', async () => {
    expect(await status(id)).toMatchObject({ status: 'report_ready', stage: 'Report ready', skillName: 'health', previewFindings: FLOW_FINDING_LINES })
    const trace = (await getTrace(FLOW.ownerId, { requestId: id }))!
    expect(trace.runs).toHaveLength(1)
    expect(trace.steps.length).toBe(10)
    expect(trace.attempts).toEqual([])
    // A report doesn't hold the repo: the next request can go.
    expect((await getRepoLifecycle(FLOW.ownerId, s.repoId)).stage).toBe('report_ready')
  })
})

describe('a fix request', () => {
  it('that opens a PR: agent_pr_created, a PR-ready notification, the attempt linked to the request', async () => {
    const id = await launch('ship', objective('Fix the flaky date test', 'pr'))
    expect(await waitForRequest(DB, id, ['pr'])).toMatchObject({ pr_url: FLOW_PR_URL, attempts: 1 })
    // The row flips before its events are written: read them once the job is done.
    await settled(id)

    const events = await eventsFor(id)
    expect(events.map(e => e.event_type)).toEqual(['agent_task_queued', 'agent_pr_created'])
    expect(events[1].metadata).toMatchObject({ taskId: id, prUrl: FLOW_PR_URL, executor: 'factory', mode: 'fix', skillName: 'ship' })
    expect(await notificationsFor(id)).toEqual([{ event_type: 'agent_pr_ready', title: expect.stringMatching(/^Agent PR ready for review/) }])

    const [job] = await q<{ id: string; status: string; pr_url: string | null; tier: string }>(DB, 'SELECT id, status, pr_url, tier FROM agent_jobs WHERE request_id = $1', [id])
    expect(job).toMatchObject({ status: 'verified', pr_url: FLOW_PR_URL, tier: 'M1' })
    const trace = (await getTrace(FLOW.ownerId, { requestId: id }))!
    expect(trace.attempts.map(a => a.id)).toEqual([job.id])
    expect(trace.steps.filter(x => ['attempt', 'judge', 'pr'].includes(x.step)).every(x => x.jobId === job.id)).toBe(true)

    expect(await status(id)).toMatchObject({ status: 'pr_ready', prUrl: FLOW_PR_URL })
    // An open agent PR holds the repo until it is merged or closed.
    await expect(launch('ship', 'Something else')).rejects.toThrow(`PR: ${FLOW_PR_URL}`)
    await q(DB, `INSERT INTO portfolio_events (user_id, repo_id, event_type, title, metadata) VALUES ($1, $2, 'agent_pr_merged', 'merged', $3)`,
      [FLOW.ownerId, s.repoId, JSON.stringify({ taskId: id, prUrl: FLOW_PR_URL })])
    expect(await status(id)).toMatchObject({ status: 'merged', prUrl: FLOW_PR_URL })
  })

  it("held at stage 'report': verified, no PR event, the reason says how to promote it", async () => {
    const id = await launch('ship', objective('Rename the helper', 'verified'))
    const row = await waitForRequest(DB, id, ['verified'])
    expect(row.reason).toMatch(/promote it to 'pr'/)
    expect((await eventsFor(id)).map(e => e.event_type)).toEqual(['agent_task_queued'])
    expect(await q(DB, 'SELECT reported FROM agent_jobs WHERE request_id = $1', [id])).toEqual([{ reported: true }])
    expect(await status(id)).toMatchObject({ status: 'verified', stage: 'Verified — held, no PR' })
  })

  it('rejected by the judge: agent_execution_failed and a failure notification', async () => {
    const id = await launch('qa', objective('Fix the login bug', 'rejected'))
    expect(await waitForRequest(DB, id, ['rejected'])).toMatchObject({ reason: 'judge: a check regressed' })
    await settled(id)
    const events = await eventsFor(id)
    expect(events.map(e => e.event_type)).toEqual(['agent_task_queued', 'agent_execution_failed'])
    expect(events[1].metadata).toMatchObject({ requestStatus: 'rejected', reason: 'judge: a check regressed' })
    expect(await notificationsFor(id)).toEqual([{ event_type: 'agent_failed', title: expect.stringMatching(/^Agent request rejected/) }])
    expect(await status(id)).toMatchObject({ status: 'failed', reason: 'judge: a check regressed' })
  })
})

describe('when a run cannot finish', () => {
  it('deferred (LiteLLM down): back to queued with the reason, not a failure; the retry then succeeds', async () => {
    const id = await launch('review', objective('Review the auth module', 'defer-once'))
    const deferred = await waitFor(async () => {
      const row = await requestRow(DB, id)
      return row?.status === 'queued' && row.reason === FLOW_DEFER_REASON ? row : null
    }, 'the deferral')
    expect(deferred.attempts).toBe(1)
    const job = await delayedJob(id)
    // retryInMinutes: 30 from the run.
    expect(job.delay).toBeGreaterThan(25 * 60_000)
    expect(job.data).toEqual({ requestId: id })
    expect((await runsFor(id))[0]).toMatchObject({ status: 'skipped', summary: expect.objectContaining({ reason: FLOW_DEFER_REASON }) })
    expect(await status(id)).toMatchObject({ status: 'queued', reason: FLOW_DEFER_REASON })

    await promote(id)
    expect(await waitForRequest(DB, id, ['reported'])).toMatchObject({ attempts: 2, reason: null })
    await settled(id)
    expect((await runsFor(id)).map(r => r.status)).toEqual(['skipped', 'ok'])
    expect((await getTrace(FLOW.ownerId, { requestId: id }))!.runs).toHaveLength(2)
  })

  it('failed runs retry twice, then the request fails with the reason', async () => {
    const id = await launch('investigate', objective('Find the memory leak', 'fail'))
    for (const n of [1, 2]) {
      await waitFor(async () => {
        const row = await requestRow(DB, id)
        return row?.status === 'queued' && row.reason?.includes(`retrying (${n}/3)`) ? row : null
      }, `retry ${n}`)
      const job = await delayedJob(id)
      expect(job.data).toEqual({ requestId: id, failures: n })
      await job.promote()
    }
    const row = await waitForRequest(DB, id, ['failed'])
    expect(row.reason).toBe(`${FLOW_FAIL_REASON} (after 3 attempts)`)
    expect(row.attempts).toBe(3)
    await settled(id)
    expect((await eventsFor(id)).map(e => e.event_type)).toEqual(['agent_task_queued', 'agent_execution_failed'])
    expect((await runsFor(id)).map(r => r.status)).toEqual(['failed', 'failed', 'failed'])
  })

  it('a job that crashes without a result counts as a failed run', async () => {
    const id = await launch('qa-only', objective('Hunt for bugs', 'crash'))
    const row = await waitFor(async () => {
      const r = await requestRow(DB, id)
      return r?.status === 'queued' && r.reason?.includes('retrying (1/3)') ? r : null
    }, 'the crash retry')
    expect(row.reason).toMatch(/^exited 3 \(log: .*\.log\) — retrying \(1\/3\)$/)
    expect((await runsFor(id))[0]).toMatchObject({ status: 'failed', error: expect.stringMatching(/^exited 3/) })
    await cancelRequest(id)
  })
})

describe('the worker refuses or holds work it should not run now', () => {
  it('a request for a repo that left the allowlist is rejected without running', async () => {
    const id = 'flow-outside-request'
    await q(DB, `INSERT INTO agent_requests (id, user_id, repo_id, repo, mode, skill, objective, source) VALUES ($1, $2, $3, $4, 'fix', 'ship', 'x', 'mcp')`,
      [id, FLOW.ownerId, s.outsideRepoId, FLOW.outsideRepo])
    await queue.add('request', { requestId: id }, requestJobOptions(id))
    expect(await waitForRequest(DB, id, ['rejected'])).toMatchObject({ reason: `${FLOW.outsideRepo} is not on the factory allowlist (factory/factory.config.json "repos")` })
    await settled(id)
    expect(await runsFor(id)).toEqual([])
    expect((await eventsFor(id)).map(e => e.event_type)).toEqual(['agent_execution_failed'])
  })

  it('a cancelled request is dropped when its job comes up', async () => {
    await setQueuePaused(true)
    try {
      const id = await launch('retro', objective('Weekly retro', 'report'))
      await cancelRequest(id)
      // As if removing the job had failed: the worker must still not run it.
      await queue.add('request', { requestId: id }, requestJobOptions(id))
      await setQueuePaused(false)
      const job = await waitFor(async () => {
        const j = await queue.getJob(id)
        return j && (await j.getState()) === 'completed' ? j : null
      }, 'the dropped job')
      expect(job.returnvalue).toEqual({ status: 'skipped', reason: 'request is no longer open (cancelled or already resolved)' })
      expect((await requestRow(DB, id))?.status).toBe('cancelled')
      expect(await runsFor(id)).toEqual([])
    } finally {
      await setQueuePaused(false)
    }
  })

  it('a paused queue holds requests; resuming runs them', async () => {
    await setQueuePaused(true)
    let id = ''
    try {
      id = await launch('health', objective('Health while paused', 'report'))
      await new Promise(r => setTimeout(r, 2_500))
      expect(await requestRow(DB, id)).toMatchObject({ status: 'queued', attempts: 0 })
      expect((await getAgentHqOverview(FLOW.ownerId)).queue).toMatchObject({ paused: true })
    } finally {
      await setQueuePaused(false)
    }
    await waitForRequest(DB, id, ['reported'])
  })

  it('the PAUSE file makes requests wait (with the reason) without losing them', async () => {
    const pause = path.join(home.home, 'PAUSE')
    writeFileSync(pause, '')
    try {
      const id = await launch('health', objective('Health under PAUSE', 'report'))
      await waitFor(async () => (await requestRow(DB, id))?.reason?.startsWith('paused') ? true : null, 'the PAUSE reason')
      expect(await requestRow(DB, id)).toMatchObject({ status: 'queued', attempts: 0 })
      const job = await delayedJob(id)
      expect(job.delay).toBeGreaterThan(14 * 60_000)
      rmSync(pause)
      await job.promote()
      await waitForRequest(DB, id, ['reported'])
    } finally {
      if (existsSync(pause)) rmSync(pause)
    }
  })
})

describe('scheduled work', () => {
  it('Run now: a manual cycle runs and is traced, then reconciles requests that lost their job', async () => {
    const lost = 'flow-lost-request'
    await q(DB, `INSERT INTO agent_requests (id, user_id, repo_id, repo, mode, skill, objective, source) VALUES ($1, $2, $3, $4, 'report', 'health', $5, 'auto-dispatch')`,
      [lost, FLOW.ownerId, s.repoId, FLOW.allowlistedRepo, objective('Lost job', 'report')])
    const { jobId } = await runNow('cycle')
    const run = await waitFor(async () => {
      const [r] = await q<{ id: string; status: string; trigger: string; summary: Record<string, unknown> }>(DB, `SELECT id, status, trigger, summary FROM automation_runs WHERE job_id = $1 AND finished_at IS NOT NULL`, [jobId])
      return r ?? null
    }, 'the manual cycle')
    expect(run).toMatchObject({ status: 'ok', trigger: 'manual', summary: { flow: true, job: 'cycle' } })
    expect((await q(DB, 'SELECT step, status FROM trace_events WHERE run_id = $1 ORDER BY id', [run.id]))).toEqual([
      { step: 'cycle', status: 'start' }, { step: 'cycle', status: 'ok' },
    ])
    await worker.waitForLog(new RegExp(`reconcile: re-queued request ${lost}`))
    await waitForRequest(DB, lost, ['reported'])
  })

  it('the daily report job prunes runs older than 90 days, with their traces', async () => {
    const old = new Date(Date.now() - 100 * 86_400_000).toISOString()
    await q(DB, `INSERT INTO automation_runs (id, user_id, kind, trigger, status, started_at, finished_at) VALUES ('flow-old-run', $1, 'factory-cycle', 'schedule', 'ok', $2, $2)`, [FLOW.ownerId, old])
    await q(DB, `INSERT INTO trace_events (run_id, step, status, at) VALUES ('flow-old-run', 'cycle', 'ok', $1)`, [old])
    const { jobId } = await runNow('report')
    await waitFor(async () => (await q(DB, `SELECT 1 FROM automation_runs WHERE job_id = $1 AND status = 'ok'`, [jobId])).length > 0, 'the report run')
    await waitFor(async () => (await q(DB, `SELECT 1 FROM automation_runs WHERE id = 'flow-old-run'`)).length === 0, 'the prune')
    expect(await q(DB, `SELECT 1 FROM trace_events WHERE run_id = 'flow-old-run'`)).toEqual([])
    expect((await q(DB, `SELECT count(*)::int AS n FROM automation_runs WHERE kind = 'factory-request'`))[0]).toMatchObject({ n: expect.any(Number) })
  })
})

describe('the Agents page data with a live worker', () => {
  it('shows the worker, the schedules with their next runs, the runs and the requests', async () => {
    const o = await getAgentHqOverview(FLOW.ownerId)
    expect(o.redis).toBe('connected')
    expect(o.worker?.pid).toBe(worker.child.pid)
    expect(o.schedulers.map(x => x.name).sort()).toEqual(['cycle', 'report', 'scout'])
    expect(o.schedulers.every(x => x.next && new Date(x.next) > new Date())).toBe(true)
    expect(o.runs.some(r => r.kind === 'factory-request' && r.status === 'ok')).toBe(true)
    expect(o.requests.map(r => r.status)).toEqual(expect.arrayContaining(['reported', 'pr', 'verified', 'rejected', 'failed', 'cancelled']))
    expect(o.queue).toMatchObject({ active: 0, paused: false })
  })

  it('shows the job that is running and its latest step, live', async () => {
    const id = await launch('ship', objective('A long change', 'slow'))
    const active = await waitFor(async () => {
      const o = await getAgentHqOverview(FLOW.ownerId)
      return o.activeJob?.id === id && o.activeJob.progress?.step === 'clone' ? o.activeJob : null
    }, 'the active job')
    expect(active).toMatchObject({ name: 'request', progress: { step: 'clone', status: 'start' } })
    expect(await requestRow(DB, id)).toMatchObject({ status: 'running', attempts: 1 })
    expect(await status(id)).toMatchObject({ status: 'running' })
  })

  it('SIGTERM mid-run: the request goes back to the queue, the worker exits cleanly and records the stop', async () => {
    const [{ id }] = await q<{ id: string }>(DB, `SELECT id FROM agent_requests WHERE status = 'running'`)
    expect(await worker.stop()).toBe(0)
    expect(await requestRow(DB, id)).toMatchObject({ status: 'queued', reason: 'the worker restarted mid-run — retrying' })
    expect(await (await queue.getJob(id))!.getState()).toBe('delayed')
    // Recorded, not deleted: the Agents page says "stopped", not "asleep".
    expect(parseWorkerStatus(await workerStatusRaw())).toMatchObject({ stopReason: 'SIGTERM', stoppedAt: expect.any(String), pid: worker.child.pid })
    await cancelRequest(id)
  })
})

describe('the real run.ts as the job', () => {
  it('runs the request path and defers it here: unattended runs refuse to run without the sandbox', async () => {
    const real = await startWorker(flowEnv(DB, home, { FACTORY_WORKER_CHILD: '' }))
    try {
      const id = await launch('health', 'Check the health')
      const row = await waitFor(async () => {
        const r = await requestRow(DB, id)
        return r?.status === 'queued' && r.reason ? r : null
      }, 'the real run.ts deferral', 60_000)
      expect(row.reason).toBe('refused: scheduled cycles only run sandboxed (sandbox.mode is "off"); repo code never runs on the host unattended')
      expect(row.attempts).toBe(1)
      const [run] = await runsFor(id)
      expect(run).toMatchObject({ kind: 'factory-request', status: 'skipped' })
      // Written by the real run.ts in its own process, through the Neon HTTP driver.
      expect(await stepsFor(run.id)).toEqual([expect.objectContaining({ step: 'request', status: 'info', request_id: id, detail: `report request on ${FLOW.allowlistedRepo} (/health)` })])
      await cancelRequest(id)
    } finally {
      expect(await real.stop()).toBe(0)
    }
  })
})
