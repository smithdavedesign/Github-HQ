/**
 * /api/agent-task-status (roadmap Phase 81): what the Run-agent buttons and the skill launcher
 * poll. A factory request's row is the truth until a PR outcome event exists; older Nexus tasks
 * are projected from their events.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type Event = { eventType: string; metadata: Record<string, unknown> | null; occurredAt: Date }
let session: { user: { id: string } } | null
let events: Event[]
let row: { status: string; prUrl: string | null; reason: string | null } | undefined
const lifecycle = vi.fn()

vi.mock('@/lib/auth', () => ({ auth: async () => session }))
vi.mock('@/lib/db', () => ({
  db: { query: { portfolioEvents: { findMany: async () => events }, agentRequests: { findFirst: async () => row } } },
}))
vi.mock('@/lib/agents/lifecycle', () => ({ getRepoLifecycle: (...a: unknown[]) => lifecycle(...a) }))

const { GET } = await import('@/app/api/agent-task-status/route')
const { LIFECYCLE_TIMEOUT_MS } = await import('@/lib/agents/lifecycle-utils')

async function get(query: string) {
  const res = await GET(new Request(`http://localhost/api/agent-task-status?${query}`))
  return { code: res.status, body: await res.json() as Record<string, unknown> }
}
const ev = (eventType: string, taskId: string, extra: Record<string, unknown> = {}, at = new Date()): Event => ({ eventType, metadata: { taskId, ...extra }, occurredAt: at })

beforeEach(() => {
  session = { user: { id: 'owner' } }
  events = []
  row = undefined
  lifecycle.mockReset()
})

describe('requests', () => {
  it('401 signed out; 400 without a task or with a bad repo id', async () => {
    session = null
    expect((await get('taskId=t')).code).toBe(401)
    session = { user: { id: 'owner' } }
    expect((await get('')).code).toBe(400)
    expect((await get('repoId=abc')).code).toBe(400)
  })

  it('?repoId= returns the repo lifecycle (button hydration)', async () => {
    lifecycle.mockResolvedValue({ stage: 'queued', taskId: 't1', prUrl: null, queuedAt: new Date(), reason: 'waiting for AC power' })
    expect(await get('repoId=7')).toEqual({ code: 200, body: { status: 'queued', stage: 'Queued — waiting for the factory', monitorUrl: '/agent-performance', taskId: 't1', prUrl: null, reason: 'waiting for AC power' } })
    expect(lifecycle).toHaveBeenCalledWith('owner', 7)
  })
})

describe('Agent HQ requests: the row', () => {
  it.each([
    ['queued', 'queued', 'Queued — waiting for the factory'],
    ['running', 'running', 'Agent running…'],
    ['pr', 'pr_ready', 'PR created'],
    ['verified', 'verified', 'Verified — held, no PR'],
    ['reported', 'report_ready', 'Report ready'],
    ['rejected', 'failed', 'Agent failed'],
    ['failed', 'failed', 'Agent failed'],
    ['cancelled', 'idle', 'Idle'],
  ])('%s → %s', async (status, stage, label) => {
    row = { status, prUrl: status === 'pr' ? 'https://github.com/o/r/pull/3' : null, reason: status === 'failed' ? 'the harness crashed' : null }
    const { body } = await get('taskId=t1')
    expect(body).toMatchObject({ status: stage, stage: label, monitorUrl: '/agent-performance', prUrl: row.prUrl, reason: row.reason })
  })

  it('a report carries a two-finding preview and the skill', async () => {
    row = { status: 'reported', prUrl: null, reason: null }
    events = [ev('agent_skill_report', 't1', { skillName: 'health', findings: ['a', '  ', 'b', 'c'] })]
    expect((await get('taskId=t1')).body).toMatchObject({ status: 'report_ready', previewFindings: ['a', 'b'], skillName: 'health' })
  })

  it('PR outcome events win over the row, in order: merged, needs human, awaiting approval, CI failing, rejected', async () => {
    row = { status: 'pr', prUrl: 'u', reason: null }
    const chain = ['agent_pr_rejected', 'agent_ci_failed', 'agent_awaiting_approval', 'agent_needs_human', 'agent_pr_merged']
    const stages = ['rejected', 'ci_failing', 'awaiting_approval', 'needs_human', 'merged']
    for (let i = 0; i < chain.length; i++) {
      events = chain.slice(0, i + 1).map(t => ev(t, 't1', { prUrl: 'u' }))
      expect((await get('taskId=t1')).body).toMatchObject({ status: stages[i], prUrl: 'u' })
    }
  })

  it("other tasks' events are ignored", async () => {
    row = { status: 'running', prUrl: null, reason: null }
    events = [ev('agent_pr_merged', 'other')]
    expect((await get('taskId=t1')).body).toMatchObject({ status: 'running' })
  })
})

describe('older Nexus tasks: projected from events', () => {
  it('PR, report, failure, still queued, timed out', async () => {
    events = [ev('agent_pr_created', 'n1', { prUrl: 'p' }), ev('agent_task_queued', 'n1')]
    expect((await get('taskId=n1')).body).toMatchObject({ status: 'pr_ready', prUrl: 'p' })
    events = [ev('agent_skill_report', 'n1', { findings: ['x'] })]
    expect((await get('taskId=n1')).body).toMatchObject({ status: 'report_ready', previewFindings: ['x'] })
    events = [ev('agent_execution_failed', 'n1')]
    expect((await get('taskId=n1')).body).toMatchObject({ status: 'failed' })
    events = [ev('agent_task_queued', 'n1', {}, new Date(Date.now() - 60_000))]
    expect((await get('taskId=n1')).body).toMatchObject({ status: 'queued' })
    events = [ev('agent_task_queued', 'n1', {}, new Date(Date.now() - LIFECYCLE_TIMEOUT_MS - 60_000))]
    expect((await get('taskId=n1')).body).toMatchObject({ status: 'timed_out', stage: 'Timed out' })
  })
})
