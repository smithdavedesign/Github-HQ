import { describe, expect, it } from 'vitest'
import { kpiTrend, nightShiftReadiness, readinessLine, scheduledPolicy, CLEAN_NIGHTS_REQUIRED } from '../../factory/lib/night-shift'
import { loadConfig } from '../../factory/lib/config'
import type { AttemptEntry, LedgerEntry } from '../../factory/lib/ledger'
import type { JobRecord } from '../../src/lib/agents/factory-kpis'

let n = 0
/** An attempt at 03:00 local on the given calendar day (inside that night). */
const att = (day: number, isolation?: 'docker' | 'host', over: Partial<AttemptEntry> = {}): AttemptEntry => ({
  type: 'attempt', id: `a${++n}`, runId: 'r', at: new Date(2026, 9, day, 3, 0).toISOString(), repo: 'o/app', kind: 'fix-types', taskTier: 2,
  tier: 'M0', model: 'local-agent', harness: 'aider', outcome: 'verified', reason: '', exploring: false, durationMs: 1, costUsd: 0,
  inputTokens: 0, outputTokens: 0, ...(isolation ? { isolation } : {}), ...over,
})

describe('night shift readiness gate', () => {
  it('counts consecutive fully-sandboxed nights back from the latest', () => {
    const entries: LedgerEntry[] = [att(1, 'host'), ...[2, 3, 4].map(d => att(d, 'docker'))]
    expect(nightShiftReadiness(entries)).toMatchObject({ cleanNights: 3, ready: false })
  })
  it('one host-side attempt ends the streak; pre-isolation attempts count as host', () => {
    const entries: LedgerEntry[] = [att(1, 'docker'), att(2, 'docker'), att(2), att(3, 'docker')]
    const r = nightShiftReadiness(entries)
    expect(r.cleanNights).toBe(1)
    expect(r.lastHostNight).toBe('2026-10-01')
  })
  const NOW = new Date(2026, 9, 8, 12, 0)
  it('7 clean nights pass the sandbox half; rate-limited attempts are ignored', () => {
    const entries: LedgerEntry[] = [att(1, 'host', { outcome: 'rate_limited' }), ...[1, 2, 3, 4, 5, 6, 7].map(d => att(d, 'docker'))]
    expect(nightShiftReadiness(entries, 7, NOW)).toMatchObject({ cleanNights: CLEAN_NIGHTS_REQUIRED, sandboxReady: true })
    expect(readinessLine(nightShiftReadiness([], 7, NOW))).toMatch(/0\/7/)
  })
  it('clean nights alone are not enough: the gate also needs accepted, useful PRs', () => {
    const entries: LedgerEntry[] = [1, 2, 3, 4, 5, 6, 7].map(d => att(d, 'docker'))
    const r = nightShiftReadiness(entries, 7, NOW)
    expect(r).toMatchObject({ sandboxReady: true, ready: false, quality: { met: false } })
    expect(readinessLine(r)).toMatch(/5 more merged or closed PR\(s\).*3 more scored PR\(s\)/)
  })
  it('is ready with 7 clean nights, ≥ 50% acceptance over ≥ 5 resolved PRs and ≥ 50% of scored PRs useful', () => {
    const prs = [1, 2, 3, 4, 5, 6, 7].map(d => att(d, 'docker', { prUrl: `https://github.com/o/app/pull/${d}` }))
    const res = (a: AttemptEntry, outcome: 'merged' | 'rejected'): LedgerEntry => ({ type: 'resolution', attemptId: a.id, at: NOW.toISOString(), outcome })
    const val = (a: AttemptEntry, value: number): LedgerEntry => ({ type: 'value', attemptId: a.id, at: NOW.toISOString(), value })
    const entries: LedgerEntry[] = [
      ...prs, res(prs[0], 'merged'), res(prs[1], 'merged'), res(prs[2], 'merged'), res(prs[3], 'rejected'), res(prs[4], 'rejected'),
      val(prs[0], 3), val(prs[1], 2), val(prs[2], 1),
    ]
    const r = nightShiftReadiness(entries, 7, NOW)
    expect(r.quality).toMatchObject({ resolved: 5, rated: 3, met: true })
    expect(r.ready).toBe(true)
    expect(readinessLine(r)).toMatch(/ready.*60% accepted, 67% useful/)
  })
  it('low acceptance or too few useful PRs keeps the gate shut', () => {
    const prs = [1, 2, 3, 4, 5].map(d => att(d, 'docker', { prUrl: `https://github.com/o/app/pull/${d}` }))
    const entries: LedgerEntry[] = [
      ...prs,
      ...prs.map((a, i): LedgerEntry => ({ type: 'resolution', attemptId: a.id, at: NOW.toISOString(), outcome: i < 2 ? 'merged' : 'rejected' })),
      { type: 'value', attemptId: prs[0].id, at: NOW.toISOString(), value: 1 },
    ]
    expect(nightShiftReadiness(entries, 7, NOW).quality.missing).toEqual(['acceptance 40% < 50%', '2 more scored PR(s) (outcomes are scored a day after merging)'])
  })
})

describe('scheduled policy', () => {
  const env = (e: Record<string, string> = {}) => e as NodeJS.ProcessEnv
  it('refuses to run unattended with the sandbox off', () => {
    expect(scheduledPolicy(loadConfig(env({ FACTORY_SANDBOX: 'off' }))).refuse).toMatch(/only run sandboxed/)
  })
  it('always runs at $0, whatever the manual budget', () => {
    const p = scheduledPolicy(loadConfig(env({ FACTORY_MONTHLY_BUDGET_USD: '25' })))
    expect(p.refuse).toBeNull()
    expect(p.cfg.monthlyBudgetUsd).toBe(0)
    expect(p.notes[0]).toMatch(/\$0/)
    expect(scheduledPolicy(loadConfig(env())).notes).toEqual([])
  })
})

describe('KPI trend (Phase 80 success measure)', () => {
  const now = new Date('2026-10-31T12:00:00Z')
  const job = (daysAgo: number, outcome: 'merged' | 'rejected' | null): JobRecord => ({
    id: `${daysAgo}-${outcome}-${Math.random()}`, startedAt: new Date(now.getTime() - daysAgo * 86_400_000), tier: 'M0', status: 'verified',
    prUrl: 'p', outcome, resolvedAt: null, humanCommits: 0, requests: null, adversaryModel: null,
  })
  it('rising when yield goes up and acceptance does not fall', () => {
    const jobs = [job(20, 'merged'), job(21, 'rejected'), job(3, 'merged'), job(4, 'merged'), job(5, 'merged')]
    expect(kpiTrend(jobs, now).direction).toBe('rising')
  })
  it('falling when acceptance drops', () => {
    const jobs = [job(20, 'merged'), job(21, 'merged'), job(3, 'merged'), job(4, 'rejected'), job(5, 'rejected')]
    expect(kpiTrend(jobs, now).direction).toBe('falling')
  })
  it('null without data in both halves', () => {
    expect(kpiTrend([job(3, 'merged')], now).direction).toBeNull()
  })
})
