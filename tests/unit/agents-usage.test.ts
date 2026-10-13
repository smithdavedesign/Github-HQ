import { describe, it, expect } from 'vitest'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { claudeUsage, copilotUsage, engineText, ideaLimits, ideaRuns, runningBuilds, type LogEvent } from '../../src/lib/agents/usage-utils'
import { copilotUsageData, copilotUsageMessage, publishCopilotUsage } from '../../factory/lib/copilot-quota'
import type { emitEvent } from '../../factory/system/events'

const NOW = new Date('2026-10-11T21:00:00Z')
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000)
const ev = (over: Partial<LogEvent>): LogEvent => ({
  ts: ago(10), system: 'idea-factory', component: 'research', event: 'run', status: 'ok', message: '', durationMs: null, subject: null, data: null, ...over,
})

describe('Agents page: the idea pipeline from the system log', () => {
  it('reads new events (with data) and older ones (message only), newest first', () => {
    const runs = ideaRuns([
      ev({ ts: ago(120), component: 'build', event: 'M1', message: 'M1 PR https://github.com/o/codespend/pull/1, tests passing, engine claude, advisor 2', subject: { idea: 'codespend', pr: 'https://github.com/o/codespend/pull/1' } }),
      ev({ ts: ago(60), component: 'research', message: 'recorded tiebreak on claude-sonnet-5-5 (seeded)', durationMs: 86_385, subject: { idea: 'tiebreak' } }),
      ev({ ts: ago(5), component: 'build', event: 'M1', status: 'ok', durationMs: 1_800_000, subject: { idea: 'dawnlog', pr: 'https://github.com/o/dawnlog/pull/1' },
        data: { milestone: 'M1', manual: true, model: 'claude-opus-5-5', engine: 'claude', effort: 'xhigh', fellBack: false } }),
      ev({ component: 'pipeline', event: 'tick' }),
      ev({ system: 'factory', component: 'build' }),
    ])
    expect(runs.map(r => `${r.kind}:${r.idea}`)).toEqual(['build:dawnlog', 'research:tiebreak', 'build:codespend'])
    expect(runs[0]).toMatchObject({ manual: true, model: 'claude-opus-5-5', engine: 'claude', durationMs: 1_800_000, prUrl: 'https://github.com/o/dawnlog/pull/1', fellBack: false })
    expect(runs[1]).toMatchObject({ seeded: true, model: 'claude-sonnet-5-5', engine: 'claude' })
    expect(runs[2]).toMatchObject({ engine: 'claude', model: null, milestone: 'M1', durationMs: null })
    expect(ideaRuns([ev({ component: 'build', event: 'M1', message: 'M1 PR x, tests failing, engine free' })])[0]).toMatchObject({ engine: 'free', fellBack: true })
  })

  it('a build is running from its start event until its result, within the timeout', () => {
    const start = (idea: string, min: number) => ev({ ts: ago(min), component: 'build', event: 'M1', status: 'start', subject: { idea }, data: { milestone: 'M1', model: 'opus' } })
    const runs = ideaRuns([
      start('dawnlog', 12),
      start('done', 50), ev({ ts: ago(5), component: 'build', event: 'M1', status: 'ok', subject: { idea: 'done' } }),
      start('stuck', 6 * 60),
    ])
    expect(runningBuilds(runs, NOW, 45).map(r => r.idea)).toEqual(['dawnlog'])
  })

  it('Claude Pro usage: runs, minutes (at least, when some runs didn’t say), fallbacks, failures, the last capacity hit', () => {
    const events = [
      ev({ ts: ago(30), component: 'research', durationMs: 120_000, data: { trigger: 'seed' } }),
      ev({ ts: ago(20), component: 'review', durationMs: null }),
      ev({ ts: ago(10), component: 'build', event: 'M1', status: 'fail', durationMs: 600_000, data: { engine: 'free', fellBack: true } }),
      ev({ ts: ago(3 * 24 * 60), component: 'research', durationMs: 60_000 }),
      ev({ ts: ago(10 * 24 * 60), component: 'research', durationMs: 60_000 }),
      ev({ ts: ago(40), component: 'claude', event: 'capacity', status: 'info', message: "Claude subscription couldn't take the work: usage limit reached" }),
      ev({ ts: ago(5), component: 'build', event: 'M1', status: 'start' }),
    ]
    const u = claudeUsage(events, NOW)
    expect(u.day).toEqual({ runs: 3, byKind: { research: 1, review: 1, build: 1, revenue: 0 }, minutes: 12, minutesPartial: true, fellBack: 1, failed: 1 })
    expect(u.week.runs).toBe(4)
    expect(u.lastCapacity).toMatchObject({ at: ago(40), message: expect.stringMatching(/usage limit reached/) })
    expect(claudeUsage([ev({ status: 'fail', message: 'Claude research failed (scout falls back to free models): exit 143' })], NOW).lastCapacity).toBeNull()
    expect(claudeUsage([ev({ status: 'fail', message: 'Claude research failed: Claude AI usage limit reached|1791' })], NOW).lastCapacity).not.toBeNull()
  })

  it('limits: builds running now against the limit, and seeded research in the last 24 hours', () => {
    const runs = ideaRuns([
      ev({ ts: ago(60), message: 'recorded a on claude-sonnet-5-5 (seeded)' }),
      ev({ ts: ago(30 * 60), message: 'recorded b on claude-sonnet-5-5 (seeded)' }),
      ev({ ts: ago(20), message: 'recorded c on claude-sonnet-5-5' }),
    ])
    const slot = { running: 1, max: 3, free: true, autoFree: true, held: 'new builds wait until tiebreak has 50 visitors a week' }
    const l = ideaLimits({ running: 2, slot, runs, policy: { research: { seeded: { maxPerDay: 3 } } }, now: NOW })
    expect(l).toEqual({ builds: { running: 2, max: 3 }, held: slot.held, seeded: { used: 1, cap: 3 } })
    expect(ideaLimits({ running: 0, slot: { ...slot, held: null }, runs: [], policy: null, now: NOW })).toMatchObject({ builds: { running: 0, max: 3 }, held: null, seeded: { cap: 3 } })
  })

  it('names the engine', () => {
    expect(engineText({ engine: 'claude', model: 'claude-opus-5-5' }, 'xhigh')).toBe('claude-opus-5-5 · xhigh')
    expect(engineText({ engine: 'free', model: 'free-agent' })).toBe('free pool (free-agent)')
    expect(engineText({ engine: 'claude', model: null })).toBe('Claude')
    expect(engineText({ engine: null, model: null })).toBeNull()
  })
})

describe('Agents page: Copilot usage', () => {
  const quota = { plan: 'individual_pro', percentRemaining: 63.4, overagePermitted: false, resetDate: '2026-11-01' }
  const data = copilotUsageData(quota, { copilotTasks: 2, copilotReviews: 1 }, { maxTasksPerDay: 6, maxReviewsPerDay: 4 }, true)

  it('the factory’s snapshot: quota plus tasks and reviews against their caps', () => {
    expect(data).toEqual({ installed: true, plan: 'individual_pro', percentRemaining: 63.4, overagePermitted: false, resetDate: '2026-11-01', tasksToday: 2, maxTasksPerDay: 6, reviewsToday: 1, maxReviewsPerDay: 4 })
    expect(copilotUsageMessage(data)).toBe('Copilot individual_pro: 63% of premium requests left (resets 2026-11-01); factory used 2/6 tasks and 1/4 reviews today')
    expect(copilotUsageMessage(copilotUsageData(null, { copilotTasks: 0, copilotReviews: 0 }, { maxTasksPerDay: 6, maxReviewsPerDay: 4 }, false))).toMatch(/^Copilot: Copilot CLI not installed;/)
  })

  it('publishes only when the snapshot changed, unless forced', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'copilot-'))
    const sent: unknown[] = []
    const emit: typeof emitEvent = (e) => { sent.push(e) }
    expect(publishCopilotUsage(home, data, { emit })).toBe(true)
    expect(publishCopilotUsage(home, data, { emit })).toBe(false)
    expect(publishCopilotUsage(home, { ...data, tasksToday: 3 }, { emit })).toBe(true)
    expect(publishCopilotUsage(home, { ...data, tasksToday: 3 }, { emit, force: true })).toBe(true)
    expect(sent).toHaveLength(3)
    expect(sent[0]).toMatchObject({ system: 'factory', component: 'copilot', event: 'usage', status: 'info', data })
    expect(JSON.parse(readFileSync(path.join(home, 'copilot-usage.json'), 'utf8')).key).toBe(JSON.stringify({ ...data, tasksToday: 3 }))
  })

  it('the page reads the newest snapshot and flags one older than a day', () => {
    const snap = (min: number) => ev({ ts: ago(min), system: 'factory', component: 'copilot', event: 'usage', status: 'info', data: { ...data } })
    expect(copilotUsage(snap(30), NOW)).toMatchObject({ percentRemaining: 63.4, tasksToday: 2, maxTasksPerDay: 6, reviewsToday: 1, plan: 'individual_pro', stale: false })
    expect(copilotUsage(snap(26 * 60), NOW)?.stale).toBe(true)
    expect(copilotUsage(null, NOW)).toBeNull()
    expect(copilotUsage(ev({ data: { installed: false } }), NOW)).toMatchObject({ installed: false, percentRemaining: null })
  })
})
