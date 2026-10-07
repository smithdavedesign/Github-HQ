import { describe, it, expect } from 'vitest'
import { snapshotFreshness, staleDataMessage, STALE_AFTER_DAYS } from '../../src/lib/health/freshness'
import { inactivityDisabled, requestsFailing, systemHealthLines, STUCK_REQUEST_HOURS, type SystemHealth } from '../../factory/lib/system-health'
import { buildMorningReport, type ReportInput } from '../../factory/lib/report'

const NOW = new Date('2026-10-06T13:45:00Z')

describe('snapshotFreshness', () => {
  it('is fresh with a snapshot today or yesterday', () => {
    expect(snapshotFreshness('2026-10-06', NOW)).toEqual({ latest: '2026-10-06', ageDays: 0, stale: false })
    expect(snapshotFreshness('2026-10-05', NOW).stale).toBe(false)
  })
  it(`is stale once ${STALE_AFTER_DAYS} days pass without a snapshot`, () => {
    expect(snapshotFreshness('2026-10-04', NOW)).toEqual({ latest: '2026-10-04', ageDays: 2, stale: true })
  })
  it('flags the 2026 outage (last snapshot Aug 14, seen Oct 6)', () => {
    const f = snapshotFreshness('2026-08-14', NOW)
    expect(f).toMatchObject({ ageDays: 53, stale: true })
    expect(staleDataMessage(f)).toMatch(/stopped 53 days ago .*2026-08-14.*60 days without a commit/)
  })
  it('accepts timestamps and Postgres date text', () => {
    expect(snapshotFreshness('2026-10-06T07:00:00.000Z', NOW).ageDays).toBe(0)
  })
  it('a new account with no snapshots is not an alarm', () => {
    expect(snapshotFreshness(null, NOW)).toEqual({ latest: null, ageDays: null, stale: false })
    expect(snapshotFreshness('not a date', NOW).stale).toBe(false)
    expect(staleDataMessage(snapshotFreshness(null, NOW))).toBeNull()
  })
})

describe('system health', () => {
  const healthy: SystemHealth = {
    disabledWorkflows: [], latestSnapshot: '2026-10-06',
    requests: { resolved: { pr: 2, reported: 1, failed: 1 }, waiting: 1, oldestWaitingHours: 3 },
  }

  it('keeps only workflows GitHub disabled for inactivity', () => {
    expect(inactivityDisabled('o/hq', [
      { name: 'CI', state: 'active' },
      { name: 'Cron — Sync', state: 'disabled_inactivity' },
      { name: 'Old', state: 'disabled_manually' },
    ])).toEqual([{ repo: 'o/hq', workflow: 'Cron — Sync', state: 'disabled_inactivity' }])
  })

  it('agent requests are failing at 3+ failures and more than two per landed one, or when one is stuck', () => {
    expect(requestsFailing({ resolved: { failed: 2, rejected: 3 }, waiting: 0, oldestWaitingHours: null })).toBe(true)
    expect(requestsFailing({ resolved: { failed: 2 }, waiting: 0, oldestWaitingHours: null })).toBe(false)
    expect(requestsFailing({ resolved: { failed: 4, pr: 1, reported: 1 }, waiting: 0, oldestWaitingHours: null })).toBe(false)
    expect(requestsFailing({ resolved: {}, waiting: 1, oldestWaitingHours: STUCK_REQUEST_HOURS })).toBe(true)
  })

  it('a healthy system raises no alarm', () => {
    const r = systemHealthLines(healthy, NOW)
    expect(r.alarm).toBe(false)
    expect(r.lines.join('\n')).toMatch(/all enabled[\s\S]*last health snapshot 2026-10-06[\s\S]*Agent requests, last 7 days: 2 PR, 1 reported, 1 failed · 1 waiting \(oldest 3h\)/)
  })

  it('alarms on disabled workflows, stale data and failing requests', () => {
    const r = systemHealthLines({
      disabledWorkflows: [{ repo: 'o/hq', workflow: 'Cron — Sync', state: 'disabled_inactivity' }],
      latestSnapshot: '2026-08-14',
      requests: { resolved: { failed: 7 }, waiting: 2, oldestWaitingHours: 60 },
    }, NOW)
    expect(r.alarm).toBe(true)
    expect(r.lines.filter(l => l.startsWith('⚠'))).toHaveLength(3)
    expect(r.lines[0]).toMatch(/hq "Cron — Sync".*gh workflow enable <name> --repo o\/hq/)
  })

  it('alarms when the factory did no agent work for 36 h, and says why its runs were skipped', () => {
    const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000)
    const idle = systemHealthLines({ ...healthy, factory: { lastWorkAt: hoursAgo(40), firstRunAt: hoursAgo(900), skipReason: 'Docker is not running (repo code never runs on the host)' } }, NOW)
    expect(idle.alarm).toBe(true)
    expect(idle.lines.filter(l => l.startsWith('⚠'))).toEqual([expect.stringMatching(/^⚠ Factory: .*40 hours.*skipped: Docker is not running/)])
    const busy = systemHealthLines({ ...healthy, factory: { lastWorkAt: hoursAgo(3), firstRunAt: hoursAgo(900), skipReason: null } }, NOW)
    expect(busy).toEqual(systemHealthLines(healthy, NOW))
  })

  it('says when it could not check, without alarming; no requests, no line', () => {
    const r = systemHealthLines({ disabledWorkflows: null, latestSnapshot: null, requests: null }, NOW)
    expect(r).toEqual({ lines: ['Scheduled workflows: could not check (gh unavailable).'], alarm: false })
    const quiet = systemHealthLines({ disabledWorkflows: [], latestSnapshot: null, requests: { resolved: {}, waiting: 0, oldestWaitingHours: null } }, NOW)
    expect(quiet.lines).toEqual(['Scheduled workflows: all enabled.'])
  })
})

describe('morning report', () => {
  const base: ReportInput = {
    now: NOW, entries: [], repos: ['o/hq'], pool: {}, liteLLMUp: true, openRouterQuota: null,
    copilot: { enabled: false, model: 'x', tasksToday: 0, maxTasksPerDay: 0, reviewsToday: 0, maxReviewsPerDay: 0 },
    prTarget: { min: 3, max: 8 }, monthToDateUsd: 0, monthlyBudgetUsd: 0, cycles: [],
  }

  it('leads Ops with system health and marks the subject when something is wrong', () => {
    const r = buildMorningReport({ ...base, systemHealth: { disabledWorkflows: [], latestSnapshot: '2026-08-14', requests: null } })
    expect(r.subject.startsWith('⚠ RepoHQ factory')).toBe(true)
    expect(r.sections.find(s => s.id === 'ops')!.lines.slice(0, 2)).toEqual([
      'Scheduled workflows: all enabled.',
      expect.stringMatching(/^⚠ RepoHQ data: Scheduled data stopped 53 days ago/),
    ])
  })

  it('no system health input, no change', () => {
    const r = buildMorningReport(base)
    expect(r.subject.startsWith('RepoHQ factory')).toBe(true)
    expect(r.sections.find(s => s.id === 'ops')!.lines[0]).toMatch(/^LiteLLM gateway/)
  })
})
