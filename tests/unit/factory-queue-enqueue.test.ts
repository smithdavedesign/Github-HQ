/**
 * enqueueRequest (roadmap Phase 81): the single way work reaches the factory. Guards run in order
 * (repo, owner + allowlist, a factory mode, repo skill policy, one open request per repo) and a
 * refused request writes nothing; an accepted one is one Neon batch (row + queued event) plus a
 * best-effort BullMQ job.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import factoryConfig from '../../factory/factory.config.json'

const REPO = factoryConfig.repos[0]
let repo: { fullName: string; name: string; tags: string[] | null } | undefined
const batches: { table: string; values: Record<string, unknown> }[][] = []
const lifecycle = vi.fn()
const withQueue = vi.fn()

vi.mock('@/lib/db', async () => {
  const schema = await import('@/lib/db/schema')
  const nameOf = (t: unknown) => (t === schema.agentRequests ? 'agent_requests' : t === schema.portfolioEvents ? 'portfolio_events' : 'other')
  return {
    db: {
      query: { repositories: { findFirst: async () => repo } },
      insert: (table: unknown) => ({ values: (values: Record<string, unknown>) => ({ table: nameOf(table), values }) }),
      batch: async (ops: { table: string; values: Record<string, unknown> }[]) => { batches.push(ops) },
    },
  }
})
vi.mock('@/lib/agents/lifecycle', async () => ({
  getRepoLifecycle: (...a: unknown[]) => lifecycle(...a),
  BLOCKING_STAGES: (await import('@/lib/agents/lifecycle-utils')).BLOCKING_STAGES,
}))
vi.mock('../../factory/lib/queue', async importOriginal => ({ ...(await importOriginal<object>()), withQueue: (...a: unknown[]) => withQueue(...a) }))

const { enqueueRequest, addRequestJob, queueAdvisorActionForUser, queueSkillForUser } = await import('@/lib/agents/factory-queue')
const { requestJobOptions } = await import('../../factory/lib/queue')

const env = { ...process.env }
beforeEach(() => {
  repo = { fullName: REPO, name: REPO.split('/')[1], tags: [] }
  batches.length = 0
  lifecycle.mockReset().mockResolvedValue({ stage: 'idle', taskId: null, prUrl: null, queuedAt: null })
  withQueue.mockReset().mockResolvedValue(undefined)
  process.env.FACTORY_USER_ID = 'owner'
  process.env.REDIS_URL = 'redis://127.0.0.1:6380/5'
  delete process.env.REPO_GSTACK_SKILL_ALLOWLIST_JSON
})
afterEach(() => { process.env = { ...env } })

const input = (over: Partial<Parameters<typeof enqueueRequest>[0]> = {}) => ({
  userId: 'owner', repoId: 7, skill: 'health' as const, objective: 'Check it', source: 'ui-skill' as const, title: 'gstack /health: Check it', ...over,
})

describe('refusals write nothing', () => {
  it.each([
    ['an unknown repo', () => { repo = undefined }, input(), 'Repo 7 not found'],
    ['no factory owner configured', () => { delete process.env.FACTORY_USER_ID }, input(), /FACTORY_USER_ID is not set/],
    ['someone other than the owner', () => {}, input({ userId: 'someone' }), 'The factory runs agents for its owner only.'],
    ['a repo off the allowlist', () => { repo = { fullName: 'me/elsewhere', name: 'elsewhere', tags: [] } }, input(), /not on the factory allowlist/],
    ['/canary', () => {}, input({ skill: 'canary' }), /no factory equivalent/],
    ['a repo policy that blocks the skill', () => { repo = { fullName: REPO, name: 'x', tags: ['gstack-allow:investigate'] } }, input({ skill: 'ship', source: 'auto-dispatch' }), /Repo policy blocks \/ship/],
  ])('%s', async (_name, arrange, args, reason) => {
    arrange()
    const r = await enqueueRequest(args)
    expect(r.ok).toBe(false)
    expect(r.ok ? '' : r.reason).toMatch(reason)
    expect(batches).toEqual([])
    expect(withQueue).not.toHaveBeenCalled()
  })

  it('an open request or open agent PR on the repo (the server-side lifecycle guard)', async () => {
    lifecycle.mockResolvedValue({ stage: 'running', taskId: 't0', prUrl: null, queuedAt: new Date() })
    expect(await enqueueRequest(input())).toEqual({ ok: false, reason: `An agent task is already active for ${repo!.name} (stage: running). Wait for it to finish (or cancel it on the Agents page).` })
    lifecycle.mockResolvedValue({ stage: 'pr_ready', taskId: 't0', prUrl: 'https://github.com/o/r/pull/2', queuedAt: new Date() })
    expect(await enqueueRequest(input())).toEqual({ ok: false, reason: `${repo!.name} already has an open agent PR: https://github.com/o/r/pull/2. Merge or close it first.` })
    // CI failing on it is no reason to start another one: the PR is still open.
    lifecycle.mockResolvedValue({ stage: 'needs_human', taskId: 't0', prUrl: 'https://github.com/o/r/pull/2', queuedAt: new Date() })
    expect(await enqueueRequest(input())).toEqual({ ok: false, reason: `${repo!.name} already has an open agent PR that fails CI: https://github.com/o/r/pull/2. Merge or close it first.` })
    expect(batches).toEqual([])
  })

  it('cheap checks first: /canary is refused before the lifecycle lookup', async () => {
    await enqueueRequest(input({ skill: 'canary' }))
    expect(lifecycle).not.toHaveBeenCalled()
  })
})

describe('an accepted request', () => {
  it('is one batch — the queued row and its event, sharing the request id — then a job keyed by that id', async () => {
    const r = await enqueueRequest(input({ extra: { impactType: 'health' } }))
    expect(r).toEqual({ ok: true, taskId: expect.stringMatching(/^[0-9a-f-]{36}$/), inRedis: true })
    const taskId = r.ok ? r.taskId : ''
    expect(batches).toHaveLength(1)
    const [requestOp, eventOp] = batches[0]
    expect(requestOp).toEqual({ table: 'agent_requests', values: expect.objectContaining({ id: taskId, userId: 'owner', repoId: 7, repo: REPO, mode: 'report', skill: 'health', objective: 'Check it', source: 'ui-skill', status: 'queued' }) })
    expect(eventOp).toEqual({ table: 'portfolio_events', values: expect.objectContaining({ eventType: 'agent_task_queued', title: 'gstack /health: Check it', metadata: expect.objectContaining({ taskId, executor: 'factory', mode: 'report', impactType: 'health' }) }) })

    expect(withQueue).toHaveBeenCalledTimes(1)
    const [url, fn] = withQueue.mock.calls[0] as [string, (q: { add: (...a: unknown[]) => unknown }) => unknown]
    expect(url).toBe('redis://127.0.0.1:6380/5')
    const add = vi.fn()
    await fn({ add })
    expect(add).toHaveBeenCalledWith('request', { requestId: taskId }, requestJobOptions(taskId))
  })

  it('the launcher overrides repo skill policy (an explicit owner choice); scheduled runs do not', async () => {
    repo = { fullName: REPO, name: 'x', tags: ['gstack-allow:investigate'] }
    expect((await queueSkillForUser('owner', 7, 'ship', 'Do it', 'ui-skill')).ok).toBe(true)
    expect((await queueSkillForUser('owner', 7, 'ship', 'Do it', 'auto-dispatch')).ok).toBe(false)
  })
})

describe('the BullMQ job is best effort: Neon already holds the request', () => {
  it('no REDIS_URL: not added, and enqueueing still succeeds', async () => {
    delete process.env.REDIS_URL
    expect(await enqueueRequest(input())).toMatchObject({ ok: true, inRedis: false })
    expect(withQueue).not.toHaveBeenCalled()
  })

  it('Redis down: logged, not thrown', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    withQueue.mockRejectedValue(new Error('connect ECONNREFUSED'))
    expect(await addRequestJob('t1')).toBe(false)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('re-queues it from Neon'), 'connect ECONNREFUSED')
    warn.mockRestore()
  })
})

describe('advisor actions', () => {
  const action = { repoId: 7, repoName: 'repo', action: 'Add setup docs', impactType: 'health' as const, estimatedImpact: '+6 health', effort: 'quick' as const, reasoning: 'Nobody can run it' }

  it('Run agent: "Queued", a fix request with the accuracy metadata', async () => {
    await queueAdvisorActionForUser('owner', action, 'ui-advisor')
    const [row, event] = batches[0]
    expect(row.values).toMatchObject({ skill: 'ship', mode: 'fix', source: 'ui-advisor' })
    expect(event.values.title).toBe('Queued: Add setup docs')
    expect(event.values.metadata).toMatchObject({ impactType: 'health', effort: 'quick', predictedDelta: '+6 health', riskTier: 'tier1' })
    expect(event.values.metadata).not.toHaveProperty('autoDispatched')
  })

  it('Monday auto-dispatch: "Auto-queued" and tagged; security actions are investigations', async () => {
    await queueAdvisorActionForUser('owner', { ...action, impactType: 'security', effort: 'medium' })
    const [row, event] = batches[0]
    expect(row.values).toMatchObject({ skill: 'investigate', mode: 'report', source: 'auto-dispatch' })
    expect(event.values.title).toBe('Auto-queued: Add setup docs')
    expect(event.values.metadata).toMatchObject({ autoDispatched: true, riskTier: 'tier2' })
  })
})
