/**
 * Browser actions for Agent HQ (roadmap Phase 81): Run agent / the skill launcher
 * (src/lib/actions/agent-queue.ts) and the Agents page controls (src/lib/actions/automation.ts).
 * Each derives the user from the session; the controls refuse anyone but the factory's owner.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let session: { user: { id: string } } | null
const queueAdvisor = vi.fn()
const queueSkill = vi.fn()
const enqueue = vi.fn()
const withQueue = vi.fn()
let updated: { id: string }[] = []
let selected: { status: string }[] = []
let found: Record<string, unknown> | undefined

vi.mock('@/lib/auth', () => ({ auth: async () => session }))
vi.mock('@/lib/db', () => ({
  db: {
    update: () => ({ set: () => ({ where: () => ({ returning: async () => updated }) }) }),
    select: () => ({ from: () => ({ where: async () => selected }) }),
    query: { agentRequests: { findFirst: async () => found } },
  },
}))
vi.mock('@/lib/agents/factory-queue', async importOriginal => ({
  ...(await importOriginal<object>()),
  queueAdvisorActionForUser: (...a: unknown[]) => queueAdvisor(...a),
  queueSkillForUser: (...a: unknown[]) => queueSkill(...a),
  enqueueRequest: (...a: unknown[]) => enqueue(...a),
}))
vi.mock('../../factory/lib/queue', async importOriginal => ({ ...(await importOriginal<object>()), withQueue: (...a: unknown[]) => withQueue(...a) }))

const { queueAdvisorAction, queueGstackSkill } = await import('@/lib/actions/agent-queue')
const { cancelRequest, retryRequest, runNow, setQueuePaused } = await import('@/lib/actions/automation')

const env = { ...process.env }
beforeEach(() => {
  session = { user: { id: 'owner' } }
  process.env.FACTORY_USER_ID = 'owner'
  process.env.REDIS_URL = 'redis://127.0.0.1:6380/5'
  for (const f of [queueAdvisor, queueSkill, enqueue, withQueue]) f.mockReset()
  withQueue.mockResolvedValue(undefined)
  updated = []
  selected = [{ status: 'queued' }]
  found = undefined
})
afterEach(() => { process.env = { ...env } })

describe('Run agent and the skill launcher', () => {
  it('queue a skill as the signed-in user, trimmed, from the launcher', async () => {
    queueSkill.mockResolvedValue({ ok: true, taskId: 't1', inRedis: true })
    expect(await queueGstackSkill(7, 'health', '  Score it  ')).toEqual({ taskId: 't1', status: 'queued', monitorUrl: '/agent-performance' })
    expect(queueSkill).toHaveBeenCalledWith('owner', 7, 'health', 'Score it', 'ui-skill')
  })

  it('refuse signed-out users and empty objectives; pass the queue\'s reason through', async () => {
    await expect(queueGstackSkill(7, 'health', '   ')).rejects.toThrow('Describe what the agent should do')
    queueSkill.mockResolvedValue({ ok: false, reason: 'repo is busy' })
    await expect(queueGstackSkill(7, 'health', 'x')).rejects.toThrow('repo is busy')
    session = null
    await expect(queueGstackSkill(7, 'health', 'x')).rejects.toThrow('Unauthorized')
    await expect(queueAdvisorAction({} as never)).rejects.toThrow('Unauthorized')
  })

  it('an advisor action is queued as a ui-advisor request', async () => {
    queueAdvisor.mockResolvedValue({ ok: true, taskId: 't2', inRedis: false })
    const action = { repoId: 7, action: 'Fix it' } as never
    expect(await queueAdvisorAction(action)).toMatchObject({ taskId: 't2', monitorUrl: '/agent-performance' })
    expect(queueAdvisor).toHaveBeenCalledWith('owner', action, 'ui-advisor')
  })
})

describe('Agents page controls: owner only', () => {
  it.each([
    ['runNow', () => runNow('cycle')],
    ['setQueuePaused', () => setQueuePaused(true)],
    ['cancelRequest', () => cancelRequest('t1')],
    ['retryRequest', () => retryRequest('t1')],
  ])('%s refuses other users and signed-out sessions', async (_name, call) => {
    session = { user: { id: 'someone' } }
    await expect(call()).rejects.toThrow('The factory runs agents for its owner only.')
    session = null
    await expect(call()).rejects.toThrow('Unauthorized')
  })

  it('run now adds a manual job of a scheduled kind only, and needs Redis', async () => {
    const add = vi.fn()
    withQueue.mockImplementation(async (_url: string, fn: (q: unknown) => unknown) => fn({ add }))
    const { jobId } = await runNow('scout')
    expect(jobId).toMatch(/^manual-scout-\d+$/)
    expect(add).toHaveBeenCalledWith('scout', { trigger: 'manual' }, expect.objectContaining({ jobId, priority: 5 }))
    await expect(runNow('request' as never)).rejects.toThrow('Unknown job kind "request"')
    delete process.env.REDIS_URL
    await expect(runNow('cycle')).rejects.toThrow('The factory queue is not configured (REDIS_URL is not set).')
  })

  it('pause and resume the queue', async () => {
    const q = { pause: vi.fn(), resume: vi.fn() }
    withQueue.mockImplementation(async (_url: string, fn: (q: unknown) => unknown) => fn(q))
    expect(await setQueuePaused(true)).toEqual({ paused: true })
    expect(await setQueuePaused(false)).toEqual({ paused: false })
    expect(q.pause).toHaveBeenCalledTimes(1)
    expect(q.resume).toHaveBeenCalledTimes(1)
  })
})

describe('cancel', () => {
  it('a queued request: its job is removed when there is one', async () => {
    updated = [{ id: 't1' }]
    const remove = vi.fn()
    withQueue.mockImplementation(async (_url: string, fn: (q: unknown) => unknown) => fn({ getJob: async () => ({ remove }) }))
    await cancelRequest('t1')
    expect(remove).toHaveBeenCalled()
    updated = []
    await expect(cancelRequest('t1')).rejects.toThrow('Only a queued or running request can be cancelled.')
  })

  it('a running request: the worker is asked to stop its run (a flag it checks every heartbeat)', async () => {
    updated = [{ id: 't1' }]
    selected = [{ status: 'running' }]
    const set = vi.fn()
    const remove = vi.fn()
    withQueue.mockImplementation(async (_url: string, fn: (q: unknown) => unknown) => fn({ client: Promise.resolve({ set }), getJob: async () => ({ remove }) }))
    await cancelRequest('t1')
    expect(set).toHaveBeenCalledWith('agent-hq:cancel:t1', '1', { EX: 86_400 })
    expect(remove).not.toHaveBeenCalled() // an active job is locked by the worker
  })

  it('a Redis failure does not undo the cancel (the worker drops jobs of closed requests)', async () => {
    updated = [{ id: 't1' }]
    withQueue.mockRejectedValue(new Error('ECONNREFUSED'))
    await expect(cancelRequest('t1')).resolves.toBeUndefined()
  })
})

describe('retry', () => {
  const old = (over: Record<string, unknown> = {}) => ({ id: 'old', status: 'failed', repoId: 7, skill: 'health', mode: 'report', objective: 'Score it', source: 'ui-skill', ...over })

  it('queues the same repo, skill and objective as a new request, past repo skill policy', async () => {
    found = old()
    enqueue.mockResolvedValue({ ok: true, taskId: 'new', inRedis: true })
    expect(await retryRequest('old')).toEqual({ taskId: 'new' })
    expect(enqueue).toHaveBeenCalledWith({
      userId: 'owner', repoId: 7, skill: 'health', objective: 'Score it', source: 'ui-skill',
      title: 'Retry: Score it', extra: { retryOf: 'old' }, skipSkillPolicy: true,
    })
  })

  it('keeps advisor requests as advisor requests; anything else becomes a launcher request', async () => {
    enqueue.mockResolvedValue({ ok: true, taskId: 'new', inRedis: true })
    found = old({ source: 'ui-advisor' })
    await retryRequest('old')
    found = old({ source: 'openclaw' })
    await retryRequest('old')
    expect(enqueue.mock.calls.map(c => (c[0] as { source: string }).source)).toEqual(['ui-advisor', 'ui-skill'])
  })

  it('a request without a known skill retries as /investigate (report) or /ship (fix)', async () => {
    enqueue.mockResolvedValue({ ok: true, taskId: 'new', inRedis: true })
    found = old({ skill: null, mode: 'report' })
    await retryRequest('old')
    found = old({ skill: 'not-a-skill', mode: 'fix' })
    await retryRequest('old')
    expect(enqueue.mock.calls.map(c => (c[0] as { skill: string }).skill)).toEqual(['investigate', 'ship'])
  })

  it('refuses unknown, still-open and orphaned requests, and passes the queue\'s reason through', async () => {
    await expect(retryRequest('old')).rejects.toThrow('Request not found')
    found = old({ status: 'running' })
    await expect(retryRequest('old')).rejects.toThrow('This request is still open.')
    found = old({ repoId: null })
    await expect(retryRequest('old')).rejects.toThrow('The repo is no longer synced to RepoHQ.')
    found = old()
    enqueue.mockResolvedValue({ ok: false, reason: 'An agent task is already active' })
    await expect(retryRequest('old')).rejects.toThrow('An agent task is already active')
  })
})
