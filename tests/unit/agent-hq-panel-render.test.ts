/**
 * The Agents page panel renders its states from an overview snapshot (roadmap Phase 81): worker
 * online/offline, queue missing or unreachable, schedules, runs and requests with their actions.
 * Server-rendered with fixture data; the server actions are stubbed.
 */
import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AgentHqOverview } from '@/lib/agents/agent-hq-data'

vi.mock('@/lib/actions/automation', () => ({
  runNow: vi.fn(), setQueuePaused: vi.fn(), cancelRequest: vi.fn(), retryRequest: vi.fn(),
}))

const { AgentHqPanel } = await import('@/components/agents/agent-hq-panel')

const at = '2026-10-07T12:00:00.000Z'
const base: AgentHqOverview = {
  generatedAt: at,
  redis: 'connected',
  redisError: null,
  worker: { host: 'dave-mbp', pid: 42, startedAt: at, lastSeenAt: '2026-10-07T11:59:30.000Z', pausedFile: false, onAc: true, dockerUp: true, version: 'abc1234', activeJob: null },
  queue: { waiting: 1, active: 1, delayed: 2, prioritized: 1, completed: 9, failed: 0, paused: false },
  activeJob: { id: 'req-1', name: 'request', progress: { step: 'checks', status: 'start', detail: 'typecheck, lint, test', at } },
  schedulers: [{ name: 'cycle', pattern: '5 0-6,12,16,20-23 * * *', tz: 'America/New_York', next: '2026-10-07T16:05:00.000Z' }],
  runs: [
    { id: 'run-1', kind: 'factory-cycle', trigger: 'schedule', status: 'skipped', requestId: null, startedAt: at, finishedAt: at, durationMs: 0, summary: { reason: 'on battery power' }, error: null },
    { id: 'run-2', kind: 'cron:digest', trigger: 'schedule', status: 'ok', requestId: null, startedAt: at, finishedAt: at, durationMs: 65_000, summary: { processed: 1 }, error: null },
  ],
  requests: [
    { id: 'req-1', repo: 'o/github-hq', repoName: 'github-hq', mode: 'fix', skill: 'ship', objective: 'Add a CI workflow', source: 'ui-advisor', status: 'running', prUrl: null, findings: null, reason: null, attempts: 1, createdAt: at, claimedAt: at, resolvedAt: null },
    { id: 'req-2', repo: 'o/github-hq', repoName: 'github-hq', mode: 'fix', skill: 'qa', objective: 'Fix login', source: 'ui-skill', status: 'queued', prUrl: null, findings: null, reason: 'waiting for AC power', attempts: 0, createdAt: at, claimedAt: null, resolvedAt: null },
    { id: 'req-3', repo: 'o/github-hq', repoName: 'github-hq', mode: 'fix', skill: 'ship', objective: 'Rename foo', source: 'mcp', status: 'rejected', prUrl: null, findings: null, reason: 'diff too large', attempts: 1, createdAt: at, claimedAt: at, resolvedAt: at },
    { id: 'req-4', repo: 'o/github-hq', repoName: 'github-hq', mode: 'fix', skill: 'ship', objective: 'Bump deps', source: 'auto-dispatch', status: 'pr', prUrl: 'https://github.com/o/github-hq/pull/9', findings: null, reason: null, attempts: 1, createdAt: at, claimedAt: at, resolvedAt: at },
  ],
}

function render(overview: AgentHqOverview): string {
  const client = new QueryClient()
  return renderToStaticMarkup(createElement(QueryClientProvider, { client }, createElement(AgentHqPanel, { initial: overview })))
}

describe('AgentHqPanel', () => {
  it('shows a live worker, the running job, queue counts, schedules and runs', () => {
    const html = render(base)
    expect(html).toContain('Worker online on <span class="font-medium">dave-mbp</span>')
    expect(html).toContain('abc1234')
    expect(html).toMatch(/Running <span class="font-medium">request<\/span>/)
    expect(html).toContain('checks — typecheck, lint, test')
    expect(html).toContain('5 0-6,12,16,20-23 * * *')
    expect(html).toContain('next in 4h')
    expect(html).toContain('Factory cycle')
    expect(html).toContain('on battery power')
    expect(html).toContain('Cron · digest')
    expect(html).toContain('1m 5s')
    expect(html).toMatch(/Pause queue/)
  })

  it('lists requests with their state, reason and the right actions', () => {
    const html = render(base)
    expect(html).toContain('Add a CI workflow')
    expect(html).toContain('waiting for AC power')
    expect(html).toContain('diff too large')
    expect(html).toContain('https://github.com/o/github-hq/pull/9')
    expect(html.match(/>Cancel</g)?.length).toBe(2) // the queued and the running one
    expect(html.match(/Retry/g)?.length).toBe(1) // only the rejected one
  })

  it('tells off (asleep or stopped: requests wait) apart from not working (needs fixing)', () => {
    const asleep = render({ ...base, worker: { ...base.worker!, lastSeenAt: '2026-10-07T11:50:00.000Z', onAc: false } })
    expect(asleep).toContain('Worker off</span> — last seen 10m ago: the Mac is asleep, shut down or offline.')
    expect(asleep).not.toContain('not working')
    expect(asleep).not.toContain('>on battery<') // a stale record's flags aren't shown as current

    const stopped = render({ ...base, worker: { ...base.worker!, stoppedAt: '2026-10-07T11:55:00.000Z', stopReason: 'SIGTERM' } })
    expect(stopped).toContain('Worker off</span> — stopped 5m ago: the Mac shut down or restarted, or the worker was reinstalled.')

    const broken = render({ ...base, worker: { ...base.worker!, problem: 'requests can\'t run: FACTORY_USER_ID isn\'t set in ~/.repohq-factory/env — scheduled cycles still run' } })
    expect(broken).toContain('Worker not working</span> — requests can&#x27;t run: FACTORY_USER_ID')
    expect(broken).toContain('dave-mbp')

    expect(render({ ...base, worker: { ...base.worker!, dockerUp: false } })).toMatch(/Worker not working<\/span> — Docker isn&#x27;t running/)
    expect(render({ ...base, worker: null })).toContain('Worker not set up')
  })

  it('degrades to database-only views without Redis', () => {
    const none = render({ ...base, redis: 'not-configured', worker: null, queue: null, activeJob: null, schedulers: [] })
    expect(none).toContain('isn&#x27;t configured (REDIS_URL)')
    expect(none).toContain('Add a CI workflow') // requests still listed
    expect(none).not.toContain('Pause queue')
    const down = render({ ...base, redis: 'unreachable', redisError: 'ECONNREFUSED', worker: null, queue: null, activeJob: null, schedulers: [] })
    expect(down).toContain('didn&#x27;t answer (ECONNREFUSED)')
  })

  it('prints the same times whenever it renders (server render and hydration must match)', () => {
    // A request 45 s old in the snapshot, rendered at the snapshot and again 30 s later: measured
    // against the clock it would read "just now" on the server and "1m ago" in the browser.
    const overview = { ...base, requests: [{ ...base.requests[0], createdAt: '2026-10-07T11:59:15.000Z' }] }
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date(at))
      const server = render(overview)
      vi.setSystemTime(new Date(Date.parse(at) + 30_000))
      expect(render(overview)).toBe(server)
      expect(server).toContain('just now')
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows flags for PAUSE and battery, and Docker down as not working', () => {
    const html = render({ ...base, worker: { ...base.worker!, pausedFile: true, onAc: false, dockerUp: false }, queue: { ...base.queue!, paused: true } })
    expect(html).toContain('PAUSE file')
    expect(html).toContain('>on battery<')
    expect(html).toContain('Worker not working</span> — Docker isn&#x27;t running')
    expect(html).toContain('queue paused')
    expect(html).toMatch(/Resume queue/)
  })
})
