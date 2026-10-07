/**
 * Agents page support (roadmap Phase 81, docs/agent-hq-migration-prd.md §9): the cron run recorder,
 * the factory freshness banner, and the panel's display helpers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The recorder writes through the app's db; capture its calls instead of touching Neon.
const calls: { op: string; values?: Record<string, unknown> }[] = []
vi.mock('@/lib/db', () => {
  const chain = (op: string) => ({
    values: async (values: Record<string, unknown>) => { calls.push({ op, values }) },
    set: (values: Record<string, unknown>) => ({ where: async () => { calls.push({ op, values }) } }),
  })
  return { db: { insert: () => chain('insert'), update: () => chain('update') } }
})

const { withAutomationRun, summarize } = await import('@/lib/monitoring/automation-runs')
const { factoryStaleMessage, FACTORY_STALE_AFTER_HOURS } = await import('@/lib/health/freshness')
const { fmtDuration, fmtIn, runKindLabel } = await import('@/components/agents/format')

const authed = () => new Request('http://localhost/api/cron/sync', { headers: { authorization: 'Bearer s3cret' } })

describe('withAutomationRun (cron routes on the automation timeline)', () => {
  const original = process.env.CRON_SECRET
  beforeEach(() => { calls.length = 0; process.env.CRON_SECRET = 's3cret' })
  afterEach(() => { if (original === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = original })

  it('records an authorised call from start to finish with a numeric summary', async () => {
    const route = withAutomationRun('cron:sync', async () => Response.json({ ok: true, processed: 3, failed: 0, errors: ['a', 'b'], big: { x: 1 } }))
    const res = await route(authed())
    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ processed: 3 }) // body still readable by the caller
    expect(calls[0]).toMatchObject({ op: 'insert', values: { kind: 'cron:sync', trigger: 'schedule', status: 'running' } })
    expect(calls[1]).toMatchObject({ op: 'update', values: { status: 'ok', error: null, summary: { ok: true, processed: 3, failed: 0, errors: 2 } } })
  })

  it('marks non-2xx responses and thrown errors as failed', async () => {
    await withAutomationRun('cron:digest', async () => Response.json({ error: 'boom' }, { status: 500 }))(authed())
    expect(calls[1]).toMatchObject({ values: { status: 'failed', error: 'HTTP 500' } })
    calls.length = 0
    await expect(withAutomationRun('cron:digest', async () => { throw new Error('db down') })(authed())).rejects.toThrow('db down')
    expect(calls[1]).toMatchObject({ values: { status: 'failed', error: 'db down' } })
  })

  it('does not record unauthorised calls, or calls the route filters out', async () => {
    const route = withAutomationRun('cron:sync', async () => Response.json({ error: 'Unauthorized' }, { status: 401 }))
    expect((await route(new Request('http://localhost/api/cron/sync'))).status).toBe(401)
    await withAutomationRun('cron:ai-summary', async () => Response.json({ processed: 1 }), () => false)(authed())
    expect(calls).toEqual([])
  })

  it('summarize keeps scalars and array lengths only', () => {
    expect(summarize({ a: 1, b: true, c: 'x', d: 'y'.repeat(300), e: [1, 2], f: { g: 1 } })).toEqual({ a: 1, b: true, c: 'x', e: 2 })
    expect(summarize(null)).toBeNull()
    expect(summarize([1])).toBeNull()
  })
})

describe('factoryStaleMessage', () => {
  const now = new Date('2026-10-07T12:00:00Z')
  it('is quiet while the worker finished something recently, or before it ever ran', () => {
    expect(factoryStaleMessage(new Date('2026-10-07T01:00:00Z'), now)).toBeNull()
    expect(factoryStaleMessage(null, now)).toBeNull()
  })
  it('flags a day and a half without a finished run', () => {
    const last = new Date(now.getTime() - (FACTORY_STALE_AFTER_HOURS + 2) * 3_600_000)
    expect(factoryStaleMessage(last, now)).toMatch(/hasn't finished a run in 38 hours.*install-launchd/)
  })
})

describe('Agents panel formatting', () => {
  it('durations', () => {
    expect(fmtDuration(4_200)).toBe('4s')
    expect(fmtDuration(125_000)).toBe('2m 5s')
    expect(fmtDuration(2 * 3_600_000 + 5 * 60_000)).toBe('2h 5m')
  })
  it('next run times', () => {
    const now = Date.parse('2026-10-07T12:00:00Z')
    expect(fmtIn(null, now)).toBe('—')
    expect(fmtIn('2026-10-07T12:00:30Z', now)).toBe('now')
    expect(fmtIn('2026-10-07T12:20:00Z', now)).toBe('in 20m')
    expect(fmtIn('2026-10-07T20:05:00Z', now)).toBe('in 8h')
    expect(fmtIn('2026-10-11T12:00:00Z', now)).toBe('in 4d')
  })
  it('run kinds', () => {
    expect(runKindLabel('factory-cycle')).toBe('Factory cycle')
    expect(runKindLabel('factory-request')).toBe('Request')
    expect(runKindLabel('cron:digest')).toBe('Cron · digest')
    expect(runKindLabel('something')).toBe('something')
  })
})
