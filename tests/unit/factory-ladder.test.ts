import { describe, expect, it } from 'vitest'
import { capabilityStatus, ladderStatus } from '../../factory/lib/ladder'
import { DEFAULT_CAPABILITIES } from '../../factory/lib/config'
import { buildMorningReport, type ReportInput } from '../../factory/lib/report'
import type { AttemptEntry, LedgerEntry } from '../../factory/lib/ledger'

const now = new Date('2026-10-20T12:00:00Z')
let n = 0
const attempt = (over: Partial<AttemptEntry>): AttemptEntry => ({
  type: 'attempt', id: `a${++n}`, runId: 'r1', at: '2026-10-19T03:00:00Z', repo: 'o/app', kind: 'fix-types', taskTier: 2,
  tier: 'M0', model: 'local-agent', harness: 'aider', outcome: 'verified', reason: '', exploring: false,
  durationMs: 60_000, costUsd: 0, inputTokens: 0, outputTokens: 0, ...over,
})
const resolve = (a: AttemptEntry, outcome: 'merged' | 'rejected'): LedgerEntry => ({ type: 'resolution', attemptId: a.id, at: '2026-10-19T10:00:00Z', outcome })

describe('promotion ladder', () => {
  it('observe → report after enough sightings', () => {
    const scans: LedgerEntry[] = [1, 2, 3].map(i => ({ type: 'scan', runId: `r${i}`, at: '2026-10-18T00:00:00Z', repo: 'o/app', checks: {}, tasks: ['red-ci'] }))
    expect(capabilityStatus('red-ci', 'observe', scans.slice(0, 2), now).advice).toBe('hold')
    expect(capabilityStatus('red-ci', 'observe', scans, now)).toMatchObject({ advice: 'promote' })
  })
  it('report → pr needs 5 verified at ≥ 80%', () => {
    const ok = [1, 2, 3, 4, 5].map(() => attempt({ kind: 'red-ci', reported: true }))
    expect(capabilityStatus('red-ci', 'report', ok.slice(0, 4), now).advice).toBe('hold')
    expect(capabilityStatus('red-ci', 'report', ok, now)).toMatchObject({ advice: 'promote' })
    const shaky = [...ok, attempt({ kind: 'red-ci', outcome: 'failed' }), attempt({ kind: 'red-ci', outcome: 'failed' })]
    expect(capabilityStatus('red-ci', 'report', shaky, now).advice).toBe('hold')
  })
  it('suggests demotion when you close most of a capability\'s PRs', () => {
    const as = [1, 2, 3, 4].map(() => attempt({ kind: 'fix-tests', prUrl: 'https://github.com/o/app/pull/1' }))
    const entries: LedgerEntry[] = [...as, resolve(as[0], 'merged'), resolve(as[1], 'rejected'), resolve(as[2], 'rejected'), resolve(as[3], 'rejected')]
    expect(capabilityStatus('fix-tests', 'pr', entries, now)).toMatchObject({ advice: 'demote' })
  })
  it('ignores attempts outside the 30-day window, voided and rate-limited ones', () => {
    const old = [1, 2, 3, 4, 5].map(() => attempt({ kind: 'red-ci', at: '2026-08-01T00:00:00Z' }))
    const voided = [1, 2, 3, 4, 5].map(() => attempt({ kind: 'red-ci', voided: 'judge bug' }))
    expect(capabilityStatus('red-ci', 'report', [...old, ...voided], now).advice).toBe('hold')
  })
  it('the adversarial veto is promoted on precision against your own reviews', () => {
    const flagged = [1, 2, 3, 4, 5].map(() => attempt({ adversary: { model: 'm', verdict: 'FAIL', issues: 1 }, prUrl: 'u' }))
    const right: LedgerEntry[] = [...flagged, ...flagged.map(a => resolve(a, 'rejected'))]
    expect(capabilityStatus('adversarial-veto', 'report', right, now)).toMatchObject({ advice: 'promote' })
    const wrong: LedgerEntry[] = [...flagged, ...flagged.map(a => resolve(a, 'merged'))]
    expect(capabilityStatus('adversarial-veto', 'pr', wrong, now)).toMatchObject({ advice: 'demote' })
  })
  it('covers every configured capability', () => {
    expect(ladderStatus(DEFAULT_CAPABILITIES, [], now).map(s => s.capability)).toEqual(Object.keys(DEFAULT_CAPABILITIES))
  })
})

describe('morning report: Director section and held-back results', () => {
  const base: ReportInput = {
    now, entries: [], repos: ['o/app'], pool: {}, liteLLMUp: true, openRouterQuota: null,
    copilot: { enabled: false, model: 'gpt-5-mini', tasksToday: 0, maxTasksPerDay: 6, reviewsToday: 0, maxReviewsPerDay: 8 },
    prTarget: { min: 3, max: 8 }, monthToDateUsd: 0, monthlyBudgetUsd: 0, cycles: [],
  }
  it('lists every capability with its stage when capabilities are given', () => {
    const r = buildMorningReport({ ...base, capabilities: DEFAULT_CAPABILITIES })
    const ladder = r.sections.find(s => s.id === 'ladder')!
    expect(ladder.lines.some(l => l.startsWith('red-ci: report'))).toBe(true)
    expect(ladder.lines.at(-1)).toMatch(/factory.config.json/)
    expect(buildMorningReport(base).sections.find(s => s.id === 'ladder')).toBeUndefined()
  })
  it('shows verified report-stage results and reviewer flags in the Builder section', () => {
    const held = attempt({ at: '2026-10-20T03:00:00Z', kind: 'red-ci', reported: true })
    const flagged = attempt({ at: '2026-10-20T04:00:00Z', prUrl: 'https://github.com/o/app/pull/9', adversary: { model: 'free-agent', verdict: 'UNCERTAIN', issues: 0 } })
    const builder = buildMorningReport({ ...base, entries: [held, flagged] }).sections.find(s => s.id === 'builder')!
    expect(builder.lines.join('\n')).toMatch(/Held back .*app red-ci/)
    expect(builder.lines.join('\n')).toMatch(/\[reviewer: UNCERTAIN\]/)
  })
})
