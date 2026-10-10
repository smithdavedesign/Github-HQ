import { describe, it, expect } from 'vitest'
import { mkdtempSync, appendFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fingerprint, normalizeEvent, redact, type SystemEvent } from '../../factory/system/events'
import { decideAlerts, launchdEvents, openClawCronEvents, probesToShip, providerEvents, slackText, workflowEvents, REALERT_MS } from '../../factory/system/collector'
import { systemEventLines } from '../../factory/lib/report'

const e = (fp: string, status: SystemEvent['status'], ts: string, message = 'm'): SystemEvent => {
  const [system, component, event] = fp.split(':')
  return { ts, system: system!, component: component!, event: event!, status, level: status === 'fail' ? 'error' : 'info', message }
}

describe('event format', () => {
  it('normalizes any writer\'s line and rejects non-events', () => {
    const n = normalizeEvent({ ts: 1791700000000, system: 'idea-factory', component: 'pipeline', event: 'tick', status: 'fail', message: 'boom' })!
    expect(n).toMatchObject({ system: 'idea-factory', status: 'fail', level: 'error', message: 'boom' })
    expect(n.ts).toBe(new Date(1791700000000).toISOString())
    expect(normalizeEvent({ system: 'x' })).toBe(null)
    expect(normalizeEvent('nope')).toBe(null)
    expect(normalizeEvent({ system: 'weird', component: 'c', event: 'e' })!.system).toBe('other:weird')
    expect(normalizeEvent({ system: 'ai-stack', component: 'c', event: 'e', status: 'bogus' })!.status).toBe('info')
  })
  it('redacts secrets from messages and data before anything ships', () => {
    // Fake tokens, assembled at runtime so secret scanners don't flag the test itself.
    const msg = ['key sk-', 'abc123def456ghi Bearer abcdefghijklmnop xo', 'xb-1234567890-abc gh', 'p_abcdefghijklmnopqrstuvwxyz12 post', 'gres://u:p@h/db'].join('')
    expect(redact(msg)).not.toMatch(/sk-abc|abcdefghijklmnop|xoxb-|ghp_|postgres:\/\//)
    const n = normalizeEvent({ system: 'factory', component: 'c', event: 'e', data: { apiKey: 'plain', nested: { note: 'sk-zzzzzzzzzzzz' } } })!
    expect(n.data).toEqual({ apiKey: '[redacted]', nested: { note: '[redacted]' } })
  })
  it('fingerprints group repeats of the same thing', () => {
    expect(fingerprint({ system: 'ai-stack', component: 'litellm', event: 'probe' })).toBe('ai-stack:litellm:probe')
  })
})

describe('probes', () => {
  const now = new Date('2026-10-10T20:00:00Z')
  it('launchd: daemons must run, interval jobs must exit 0, missing jobs fail', () => {
    const out = 'PID\tStatus\tLabel\n69742\t0\tcom.repohq.factory.worker\n-\t1\tcom.user.idea-pipeline\n-\t78\tai.openclaw.gateway\n'
    const evs = launchdEvents(out, now)
    const by = (c: string) => evs.find(x => x.component === c)!
    expect(by('worker').status).toBe('ok')
    expect(by('pipeline')).toMatchObject({ status: 'fail', message: expect.stringMatching(/exited 1/) })
    expect(by('gateway')).toMatchObject({ status: 'fail', message: expect.stringMatching(/not running \(last exit 78\)/) })
    expect(by('headroom')).toMatchObject({ status: 'fail', message: expect.stringMatching(/not loaded/) })
  })
  it('OpenClaw cron runs since the last collect, named by job', () => {
    const lines = [
      JSON.stringify({ ts: 1000, jobId: 'a', action: 'finished', status: 'ok' }),
      JSON.stringify({ ts: 3000, jobId: 'a', action: 'finished', status: 'error', error: 'cron: job execution timed out' }),
      JSON.stringify({ ts: 3500, jobId: 'b', action: 'started' }),
      'not json',
    ]
    const evs = openClawCronEvents(lines, new Map([['a', 'morning-briefing']]), 2000)
    expect(evs).toHaveLength(1)
    expect(evs[0]).toMatchObject({ component: 'cron:morning-briefing', status: 'fail', message: expect.stringMatching(/timed out/) })
  })
  it('GitHub: a disabled cron workflow is a failure (the 60-day trap)', () => {
    const evs = workflowEvents('Github-HQ', [{ name: 'Cron — Sync', state: 'disabled_inactivity' }, { name: 'CI', state: 'active' }, { name: 'Cron — Digest', state: 'active' }], now)
    expect(evs.map(x => [x.component, x.status])).toEqual([['workflow:Cron — Sync', 'fail'], ['workflow:Cron — Digest', 'ok']])
  })
  it('provider errors in the LiteLLM log (out of credit) become failures', () => {
    const evs = providerEvents('AnthropicError: Your credit balance is too low to access the Anthropic API\n... credit balance is too low', now)
    expect(evs.find(x => x.event === 'anthropic-credit')).toMatchObject({ status: 'fail', message: expect.stringMatching(/2 in the last window/) })
    expect(evs.find(x => x.event === 'provider-auth')!.status).toBe('ok')
  })
  it('probes ship on change and hourly, not every 5 minutes', () => {
    const first = probesToShip([e('ai-stack:litellm:probe', 'ok', now.toISOString())], {}, now)
    expect(first.ship).toHaveLength(1)
    const later = new Date(now.getTime() + 10 * 60_000)
    expect(probesToShip([e('ai-stack:litellm:probe', 'ok', later.toISOString())], first.last, later).ship).toHaveLength(0)
    expect(probesToShip([e('ai-stack:litellm:probe', 'fail', later.toISOString())], first.last, later).ship).toHaveLength(1)
    const hour = new Date(now.getTime() + 61 * 60_000)
    expect(probesToShip([e('ai-stack:litellm:probe', 'ok', hour.toISOString())], first.last, hour).ship).toHaveLength(1)
  })
})

describe('alerts', () => {
  const t0 = new Date('2026-10-10T20:00:00Z')
  it('one alert when something starts failing, a reminder every 6h, one on recovery', () => {
    const a1 = decideAlerts([e('ai-stack:litellm:probe', 'fail', t0.toISOString(), 'down')], { open: {} }, t0)
    expect(a1.alerts.map(a => a.kind)).toEqual(['fail'])
    const t1 = new Date(t0.getTime() + 60 * 60_000)
    expect(decideAlerts([e('ai-stack:litellm:probe', 'fail', t1.toISOString())], a1.state, t1).alerts).toEqual([])
    const t2 = new Date(t0.getTime() + REALERT_MS + 1)
    const a2 = decideAlerts([e('ai-stack:litellm:probe', 'fail', t2.toISOString())], a1.state, t2)
    expect(a2.alerts.map(a => a.kind)).toEqual(['still-failing'])
    const a3 = decideAlerts([e('ai-stack:litellm:probe', 'ok', t2.toISOString(), 'up')], a2.state, t2)
    expect(a3.alerts.map(a => a.kind)).toEqual(['recovered'])
    expect(a3.state.open).toEqual({})
  })
  it('the latest event per fingerprint decides; info events never alert', () => {
    const evs = [e('x:a:b', 'fail', '2026-10-10T20:00:00Z'), e('x:a:b', 'ok', '2026-10-10T20:01:00Z'), e('x:c:d', 'info', '2026-10-10T20:00:00Z')]
    expect(decideAlerts(evs, { open: {} }, t0).alerts).toEqual([])
  })
  it('Slack text says what, how long, and why', () => {
    const text = slackText([{ kind: 'fail', fp: 'ai-stack:litellm:probe', message: 'unreachable', since: t0.toISOString() }, { kind: 'recovered', fp: 'openclaw:frontdoor:launchd', message: 'exited 0', since: new Date(t0.getTime() - 3 * 3_600_000).toISOString() }], t0)
    expect(text).toMatch(/🔴 \*ai-stack:litellm:probe\* — failing: unreachable/)
    expect(text).toMatch(/🟢 \*openclaw:frontdoor:launchd\* — recovered after 3 h: exited 0/)
  })
})

describe('reading the shared file', () => {
  it('reads only complete new lines from the stored offset, and restarts after truncation', async () => {
    const { readNewEvents } = await import('../../factory/system/collector')
    const file = path.join(mkdtempSync(path.join(tmpdir(), 'sysev-')), 'events.jsonl')
    writeFileSync(file, JSON.stringify({ system: 'factory', component: 'c', event: 'e', status: 'ok' }) + '\n')
    appendFileSync(file, '{"system":"factory","component":"c","event":"partial"') // no newline yet: not read
    const first = readNewEvents({ offset: 0 }, file)
    expect(first.events).toHaveLength(1)
    appendFileSync(file, ',"status":"fail"}\n')
    const second = readNewEvents({ offset: first.offset }, file)
    expect(second.events.map(x => x.status)).toEqual(['fail'])
    expect(readNewEvents({ offset: 10_000_000 }, file).events).toHaveLength(2) // file shrank: start over
    expect(readNewEvents({ offset: 0 }, path.join(tmpdir(), 'missing-events.jsonl'))).toEqual({ events: [], offset: 0 })
  })
})

describe('morning report', () => {
  it('lists what is failing now and the day\'s volume per system', () => {
    const lines = systemEventLines({ hours: 24, counts: [{ system: 'ai-stack', status: 'ok', n: 20 }, { system: 'ai-stack', status: 'fail', n: 2 }, { system: 'idea-factory', status: 'ok', n: 5 }],
      failingNow: [{ fingerprint: 'ai-stack:litellm-providers:anthropic-credit', message: 'Anthropic API credit is exhausted', ts: '' }] })
    expect(lines[0]).toBe('⚠ Failing now (1):')
    expect(lines[1]).toMatch(/✗ ai-stack:litellm-providers:anthropic-credit: Anthropic API credit/)
    expect(lines[2]).toBe('System log, last 24h: ai-stack 22 (2 failed) · idea-factory 5.')
    expect(systemEventLines({ hours: 24, counts: [], failingNow: [] })).toEqual(['Failing now: nothing, across every system the collector watches.'])
    expect(systemEventLines(null)).toEqual([])
  })
})
