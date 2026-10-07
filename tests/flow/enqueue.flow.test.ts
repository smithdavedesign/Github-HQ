/**
 * RepoHQ → the factory queue (roadmap Phase 81, docs/agent-hq-migration-prd.md §6–§9), for real:
 * the browser actions and API routes run against a local Postgres (through the Neon HTTP driver)
 * and a local Redis. Only the session is faked. No worker runs here (worker.flow.test.ts).
 */
import type { Queue } from 'bullmq'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { FLOW, closePools, createDatabase, flowQueue, neonUrl, q, requestRow, resetRedis, seed, type Seeded } from './harness/flow'
import { objective } from './harness/scenarios'

vi.mock('@/lib/auth', () => ({ auth: vi.fn() }))
const { auth } = await import('@/lib/auth')
const { queueAdvisorAction, queueGstackSkill } = await import('@/lib/actions/agent-queue')
const { cancelRequest, retryRequest, runNow, setQueuePaused } = await import('@/lib/actions/automation')
const { getAgentHqOverview, getTrace } = await import('@/lib/agents/agent-hq-data')
const { getRepoLifecycle } = await import('@/lib/agents/lifecycle')
const { weeklySkillReposFor } = await import('@/lib/agents/factory-queue')
const taskStatus = await import('@/app/api/agent-task-status/route')
const agentHqRoute = await import('@/app/api/agent-hq/route')
const traceRoute = await import('@/app/api/agent-hq/trace/route')

const DB = 'agent_hq_flow_enqueue'
let s: Seeded
let queue: Queue

function signIn(userId: string | null) {
  vi.mocked(auth).mockResolvedValue((userId ? { user: { id: userId }, expires: '' } : null) as never)
}

async function status(params: string) {
  const res = await taskStatus.GET(new Request(`http://flow.test/api/agent-task-status?${params}`))
  return { code: res.status, body: await res.json() as Record<string, unknown> }
}

/** Free the repo for the next request (one open request per repo). */
async function cancelOpen() {
  const open = await q<{ id: string }>(DB, `SELECT id FROM agent_requests WHERE user_id = $1 AND status IN ('queued', 'running')`, [FLOW.ownerId])
  for (const r of open) await cancelRequest(r.id)
}

beforeAll(async () => {
  await createDatabase(DB)
  s = await seed(DB)
  await resetRedis()
  process.env.DATABASE_URL = neonUrl(DB)
  process.env.REDIS_URL = FLOW.redisUrl
  process.env.FACTORY_USER_ID = FLOW.ownerId
  queue = flowQueue()
})

afterAll(async () => {
  await queue?.close()
  // The connection the Agents page data keeps (factory/lib/queue.ts withSharedQueue).
  const kept = (globalThis as { __agentHqSharedQueues?: Map<string, { queue: Queue }> }).__agentHqSharedQueues
  for (const { queue: q } of kept?.values() ?? []) await q.close()
  await closePools()
})

beforeEach(() => signIn(FLOW.ownerId))

describe('Run agent from the skill launcher', () => {
  let taskId: string

  it('writes a queued request, its queued event and a BullMQ job keyed by the request id', async () => {
    const r = await queueGstackSkill(s.repoId, 'health', '  Check the health of the repo  ')
    expect(r).toEqual({ taskId: expect.any(String), status: 'queued', monitorUrl: '/agent-performance' })
    taskId = r.taskId

    const [row] = await q(DB, 'SELECT * FROM agent_requests WHERE id = $1', [taskId])
    expect(row).toMatchObject({
      user_id: FLOW.ownerId, repo_id: s.repoId, repo: FLOW.allowlistedRepo, mode: 'report', skill: 'health',
      objective: 'Check the health of the repo', source: 'ui-skill', status: 'queued', attempts: 0, reason: null,
    })

    const events = await q<{ event_type: string; metadata: Record<string, unknown> }>(DB, 'SELECT event_type, metadata FROM portfolio_events WHERE repo_id = $1', [s.repoId])
    expect(events).toEqual([{ event_type: 'agent_task_queued', metadata: expect.objectContaining({ taskId, executor: 'factory', mode: 'report', skillName: 'health', source: 'ui-skill' }) }])

    const job = await queue.getJob(taskId)
    expect(job?.name).toBe('request')
    // Ids only in Redis: Neon holds the request.
    expect(job?.data).toEqual({ requestId: taskId })
    expect(job?.opts.priority).toBe(1)
    expect(['prioritized', 'waiting']).toContain(await job!.getState())
  })

  it('the status route and the repo lifecycle see it queued', async () => {
    expect(await status(`taskId=${taskId}`)).toEqual({ code: 200, body: { status: 'queued', stage: 'Queued — waiting for the factory', monitorUrl: '/agent-performance', prUrl: null, reason: null } })
    expect((await status(`repoId=${s.repoId}`)).body).toMatchObject({ status: 'queued', taskId })
    expect((await getRepoLifecycle(FLOW.ownerId, s.repoId)).stage).toBe('queued')
  })

  it('allows one open request per repo', async () => {
    await expect(queueGstackSkill(s.repoId, 'review', 'Review it')).rejects.toThrow(/already active/)
    expect(await q(DB, `SELECT 1 FROM agent_requests WHERE repo_id = $1`, [s.repoId])).toHaveLength(1)
  })

  it('cancels a queued request: the row is cancelled and its job removed', async () => {
    await cancelRequest(taskId)
    expect(await requestRow(DB, taskId)).toMatchObject({ status: 'cancelled', reason: 'Cancelled from the Agents page', resolved_at: expect.any(Date) })
    expect(await queue.getJob(taskId)).toBeUndefined()
    await expect(cancelRequest(taskId)).rejects.toThrow('Only a queued request can be cancelled.')
    // The repo is free again.
    expect((await getRepoLifecycle(FLOW.ownerId, s.repoId)).stage).not.toBe('queued')
  })

  it('retries a finished request as a new one with the same skill and objective', async () => {
    const { taskId: retryId } = await retryRequest(taskId)
    expect(retryId).not.toBe(taskId)
    expect(await q(DB, 'SELECT skill, mode, objective, source, status FROM agent_requests WHERE id = $1', [retryId]))
      .toEqual([{ skill: 'health', mode: 'report', objective: 'Check the health of the repo', source: 'ui-skill', status: 'queued' }])
    const [event] = await q<{ metadata: Record<string, unknown> }>(DB, `SELECT metadata FROM portfolio_events WHERE metadata->>'taskId' = $1`, [retryId])
    expect(event.metadata.retryOf).toBe(taskId)
    await expect(retryRequest(retryId)).rejects.toThrow('This request is still open.')
    await cancelOpen()
  })

  it('fix skills become fix requests; /canary has no factory equivalent', async () => {
    const r = await queueGstackSkill(s.repoId, 'ship', objective('Fix the failing test', 'pr'))
    expect((await q(DB, 'SELECT mode, skill FROM agent_requests WHERE id = $1', [r.taskId]))[0]).toEqual({ mode: 'fix', skill: 'ship' })
    await cancelOpen()
    await expect(queueGstackSkill(s.repoId, 'canary', 'Check the live app')).rejects.toThrow(/no factory equivalent/)
    await expect(queueGstackSkill(s.repoId, 'ship', '   ')).rejects.toThrow('Describe what the agent should do')
  })
})

describe('Run agent on an advisor action', () => {
  it('queues the action with its acceptance criteria and the accuracy metadata', async () => {
    const r = await queueAdvisorAction({
      repoId: s.repoId, repoName: 'repo', action: 'Add a README section on setup', impactType: 'health',
      estimatedImpact: '+6 health points', effort: 'quick', reasoning: 'New contributors cannot run it',
    })
    const [row] = await q<{ skill: string; mode: string; source: string; objective: string }>(DB, 'SELECT skill, mode, source, objective FROM agent_requests WHERE id = $1', [r.taskId])
    expect(row).toMatchObject({ skill: 'ship', mode: 'fix', source: 'ui-advisor' })
    expect(row.objective).toMatch(/^Add a README section on setup\n\nContext: New contributors cannot run it\nExpected impact: \+6 health points\n\nDone when:\n- /)
    const [event] = await q<{ title: string; metadata: Record<string, unknown> }>(DB, `SELECT title, metadata FROM portfolio_events WHERE metadata->>'taskId' = $1`, [r.taskId])
    expect(event.title).toBe('Queued: Add a README section on setup')
    expect(event.metadata).toMatchObject({ impactType: 'health', effort: 'quick', predictedDelta: '+6 health points', riskTier: 'tier1' })
    expect(event.metadata).not.toHaveProperty('autoDispatched')
    await cancelOpen()
  })

  it('security actions come back as an investigation report', async () => {
    const r = await queueAdvisorAction({
      repoId: s.repoId, repoName: 'repo', action: 'Fix the SSRF in the webhook', impactType: 'security',
      estimatedImpact: '+10 security', effort: 'medium', reasoning: 'Open alert',
    })
    expect((await q(DB, 'SELECT skill, mode FROM agent_requests WHERE id = $1', [r.taskId]))[0]).toEqual({ skill: 'investigate', mode: 'report' })
    await cancelOpen()
  })
})

describe('an open agent PR blocks its repo until it is merged or closed', () => {
  const PR = 'https://github.com/flow/pr/pull/7'
  let taskId: string
  /** A PR event for the request, `minutes` after it opened (the sync crons write these). */
  const prEvent = (type: string, minutes: number) => q(DB,
    `INSERT INTO portfolio_events (user_id, repo_id, event_type, title, metadata, occurred_at) VALUES ($1, $2, $3, $3, $4, $5)`,
    [FLOW.ownerId, s.repoId, type, JSON.stringify({ taskId, prUrl: PR }), new Date(Date.now() + minutes * 60_000).toISOString()])

  it('a PR is open: the repo is blocked', async () => {
    taskId = (await queueGstackSkill(s.repoId, 'ship', objective('Fix the failing test', 'pr'))).taskId
    await q(DB, `UPDATE agent_requests SET status = 'pr', pr_url = $2, resolved_at = now() WHERE id = $1`, [taskId, PR])
    await prEvent('agent_pr_created', 1)
    expect((await getRepoLifecycle(FLOW.ownerId, s.repoId)).stage).toBe('pr_ready')
    await expect(queueGstackSkill(s.repoId, 'review', 'Review it')).rejects.toThrow(`already has an open agent PR: ${PR}`)
  })

  it('CI fails on it and it is handed to the owner: still blocked', async () => {
    await prEvent('agent_ci_failed', 2)
    await prEvent('agent_needs_human', 3)
    expect(await getRepoLifecycle(FLOW.ownerId, s.repoId)).toMatchObject({ stage: 'needs_human', prUrl: PR })
    expect((await status(`taskId=${taskId}`)).body).toMatchObject({ status: 'needs_human', prUrl: PR })
    await expect(queueGstackSkill(s.repoId, 'review', 'Review it')).rejects.toThrow(`already has an open agent PR that fails CI: ${PR}`)
  })

  it('the owner closes it: the repo is free again', async () => {
    await prEvent('agent_pr_rejected', 4)
    expect((await getRepoLifecycle(FLOW.ownerId, s.repoId)).stage).toBe('rejected')
    const r = await queueGstackSkill(s.repoId, 'review', 'Review it')
    expect(r.status).toBe('queued')
    await cancelOpen()
  })
})

describe('who may queue work', () => {
  it('only allowlisted repos', async () => {
    await expect(queueGstackSkill(s.outsideRepoId, 'health', 'x')).rejects.toThrow(`${FLOW.outsideRepo} is not on the factory allowlist`)
  })

  it('only the factory owner, only when signed in, only when the factory is set up', async () => {
    signIn(FLOW.otherUserId)
    await expect(queueGstackSkill(s.otherRepoId, 'health', 'x')).rejects.toThrow('The factory runs agents for its owner only.')
    await expect(runNow('cycle')).rejects.toThrow('The factory runs agents for its owner only.')
    await expect(setQueuePaused(true)).rejects.toThrow('The factory runs agents for its owner only.')
    signIn(null)
    await expect(queueGstackSkill(s.repoId, 'health', 'x')).rejects.toThrow('Unauthorized')
    signIn(FLOW.ownerId)
    delete process.env.FACTORY_USER_ID
    try {
      await expect(queueGstackSkill(s.repoId, 'health', 'x')).rejects.toThrow(/FACTORY_USER_ID is not set/)
    } finally {
      process.env.FACTORY_USER_ID = FLOW.ownerId
    }
    // Nothing was written by any refusal.
    expect(await q(DB, `SELECT 1 FROM agent_requests WHERE status IN ('queued', 'running')`)).toHaveLength(0)
  })

  it('the weekly /retro and /health runs pick only repos the factory takes work for', async () => {
    expect((await weeklySkillReposFor(FLOW.ownerId, 5)).map(r => r.id)).toEqual([s.repoId])
    expect(await weeklySkillReposFor(FLOW.otherUserId, 5)).toEqual([])
  })
})

describe('without Redis', () => {
  it('the request still lands in Neon, quickly, for the worker to reconcile', async () => {
    process.env.REDIS_URL = 'redis://127.0.0.1:1'
    const t0 = Date.now()
    try {
      const r = await queueGstackSkill(s.repoId, 'health', 'Queued while Redis is down')
      expect(Date.now() - t0).toBeLessThan(9_000)
      expect((await requestRow(DB, r.taskId))?.status).toBe('queued')
      process.env.REDIS_URL = FLOW.redisUrl
      expect(await queue.getJob(r.taskId)).toBeUndefined()
    } finally {
      process.env.REDIS_URL = FLOW.redisUrl
      await cancelOpen()
    }
  })
})

describe('owner controls and the Agents page data', () => {
  it('run now adds a manual job; unknown kinds are refused', async () => {
    const { jobId } = await runNow('cycle')
    expect(jobId).toMatch(/^manual-cycle-\d+$/)
    const job = await queue.getJob(jobId)
    expect(job?.name).toBe('cycle')
    expect(job?.data).toEqual({ trigger: 'manual' })
    expect(job?.opts.priority).toBe(5)
    await expect(runNow('deploy' as never)).rejects.toThrow('Unknown job kind "deploy"')
    await job?.remove()
  })

  it('pause and resume the queue', async () => {
    await setQueuePaused(true)
    expect(await queue.isPaused()).toBe(true)
    expect((await getAgentHqOverview(FLOW.ownerId)).queue?.paused).toBe(true)
    await setQueuePaused(false)
    expect(await queue.isPaused()).toBe(false)
  })

  it('the overview shows Redis, the queue and the owner\'s requests (newest first), no worker yet', async () => {
    const r = await queueGstackSkill(s.repoId, 'retro', 'Weekly retro')
    const o = await getAgentHqOverview(FLOW.ownerId)
    expect(o.redis).toBe('connected')
    expect(o.worker).toBeNull()
    expect(o.queue!.prioritized + o.queue!.waiting).toBeGreaterThanOrEqual(1)
    expect(o.requests[0]).toMatchObject({ id: r.taskId, repoName: FLOW.allowlistedRepo.split('/')[1], skill: 'retro', status: 'queued', attempts: 0 })
    expect(o.requests.every(x => x.repo !== FLOW.outsideRepo)).toBe(true)
    // Another user sees none of it.
    expect((await getAgentHqOverview(FLOW.otherUserId)).requests).toEqual([])
    expect(await getTrace(FLOW.otherUserId, { requestId: r.taskId })).toBeNull()
    expect(await getTrace(FLOW.ownerId, { requestId: r.taskId })).toEqual({ runs: [], steps: [], attempts: [] })
    await cancelOpen()
  })

  it('polling the overview keeps one Redis connection instead of opening one per poll', async () => {
    // Redis counts every connection it accepts: five polls must not be five handshakes.
    const accepted = async () => {
      const client = await queue.client as unknown as { info(section: string): Promise<string> }
      return Number(/total_connections_received:(\d+)/.exec(await client.info('stats'))![1])
    }
    await getAgentHqOverview(FLOW.ownerId)
    const before = await accepted()
    for (let i = 0; i < 5; i++) expect((await getAgentHqOverview(FLOW.ownerId)).redis).toBe('connected')
    expect(await accepted()).toBe(before)
  })

  it('without Redis the overview degrades to what Neon knows', async () => {
    process.env.REDIS_URL = 'redis://127.0.0.1:1'
    try {
      const o = await getAgentHqOverview(FLOW.ownerId)
      expect(o.redis).toBe('unreachable')
      expect(o.queue).toBeNull()
      expect(o.requests.length).toBeGreaterThan(0)
    } finally {
      process.env.REDIS_URL = FLOW.redisUrl
    }
  })
})

describe('API routes', () => {
  it('/api/agent-hq: 401 signed out, 403 for anyone but the owner, the overview for the owner', async () => {
    signIn(null)
    expect((await agentHqRoute.GET()).status).toBe(401)
    signIn(FLOW.otherUserId)
    expect((await agentHqRoute.GET()).status).toBe(403)
    signIn(FLOW.ownerId)
    const res = await agentHqRoute.GET()
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toMatchObject({ redis: 'connected', requests: expect.any(Array), runs: expect.any(Array) })
  })

  it('/api/agent-hq/trace: 400 without an id, 404 for an unknown one, the trace for the owner', async () => {
    const [{ id }] = await q<{ id: string }>(DB, 'SELECT id FROM agent_requests ORDER BY created_at LIMIT 1')
    const get = (query: string) => traceRoute.GET(new Request(`http://flow.test/api/agent-hq/trace?${query}`))
    expect((await get('')).status).toBe(400)
    expect((await get('requestId=nope')).status).toBe(404)
    const res = await get(`requestId=${id}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ runs: [], steps: [], attempts: [] })
    signIn(FLOW.otherUserId)
    expect((await get(`requestId=${id}`)).status).toBe(403)
  })

  it('/api/agent-task-status: 401 signed out, 400 without a task or repo', async () => {
    signIn(null)
    expect((await status('taskId=x')).code).toBe(401)
    signIn(FLOW.ownerId)
    expect((await status('')).code).toBe(400)
    expect((await status('repoId=abc')).code).toBe(400)
  })
})
