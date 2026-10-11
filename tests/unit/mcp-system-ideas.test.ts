import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { formatSystemStatus } from '../../factory/system/status'
import { demandVerdict, formatIdea, formatPipeline, readLaunchLog, readValidationPolicy, type PipelineInput, type ValidationPolicy } from '../../factory/context/idea-pipeline'
import type { IdeaState } from '../../factory/context/ideas'

const now = new Date('2026-10-11T12:00:00Z')
const policy: ValidationPolicy = { days: 14, minVisitorsToJudge: 50, build: { minSignups: 5, minSignupRate: 0.05 } }
const permitly: IdeaState = {
  slug: 'permitly', title: 'permitly — STR permits', stage: 'validate',
  review: { verdict: 'validate', score: 6, summary: 'Real pain, thin demand.' },
  page: { url: 'https://p/permitly/' },
  signals: { views: 2, uniqueVisitors: 1, signups: 0 },
  validation: { startedAt: '2026-10-10T19:00:00Z', decideAfter: '2026-10-24T19:00:00Z' },
}
const input = (over: Partial<PipelineInput> = {}): PipelineInput => ({
  ideas: [permitly, { slug: 'x', title: 'X', stage: 'pass', review: { verdict: 'pass', score: 3, summary: 'Crowded.' } }],
  policy, referrers: [], launchLogs: new Map(), ideaHome: '/ih', now, ...over,
})

describe('get_system_status text', () => {
  it('lists failures first, then counts per system, then recent events', () => {
    const t = formatSystemStatus({
      hours: 24,
      counts: [{ system: 'factory', status: 'ok', n: 48 }, { system: 'factory', status: 'fail', n: 1 }, { system: 'repohq', status: 'ok', n: 3 }],
      failingNow: [{ fingerprint: 'idea-factory:research:run', status: 'fail', message: 'exit 143', ts: '2026-10-11T16:10:00Z' }],
      recent: [{ ts: '2026-10-11T20:45:00Z', system: 'factory', component: 'factory-report', event: 'run', status: 'ok', message: 'ok' }],
    })
    expect(t).toMatch(/## Failing now \(1\)\n- idea-factory:research:run \(last 10-11 16:10 UTC\): exit 143/)
    expect(t).toMatch(/- factory: 48 ok, 1 fail\n- repohq: 3 ok/)
    expect(t).toMatch(/10-11 20:45 · factory\/factory-report run: ok/)
    expect(t.indexOf('Failing now')).toBeLessThan(t.indexOf('by system'))
  })
  it('says so when nothing is failing or logged', () => {
    const t = formatSystemStatus({ hours: 6, counts: [], failingNow: [] })
    expect(t).toMatch(/## Failing now\nNothing\./)
    expect(t).toMatch(/## Last 6h by system\nNo events\./)
    expect(t).not.toMatch(/Latest/)
  })
})

describe('get_idea_pipeline text', () => {
  it('judges a demand test against the policy', () => {
    expect(demandVerdict(permitly, policy, now)).toBe('1 visitor, 0 signups (0.0%), decision in 14d (2026-10-24). needs 49 more visitors before it can be judged (min 50); short of that at the deadline it\'s extended, then parked.')
    const busy = { ...permitly, signals: { views: 90, uniqueVisitors: 60, signups: 6 } }
    expect(demandVerdict(busy, policy, now)).toMatch(/60 visitors, 6 signups \(10\.0%\).*meets the build bar/)
    expect(demandVerdict({ ...busy, signals: { views: 90, uniqueVisitors: 60, signups: 2 } }, policy, now)).toMatch(/below the build bar/)
    expect(demandVerdict({ ...permitly, validation: { ...permitly.validation!, decideAfter: '2026-10-01T00:00:00Z' } }, null, now)).toMatch(/decision due now$/)
  })
  it('groups ideas by stage with validating ones first', () => {
    const t = formatPipeline(input({ launchLogs: new Map([['permitly', { posts: [{ channel: 'r/airbnb_hosts', postedAt: '2026-10-11T10:00:00Z' }] }]]) }))
    expect(t).toMatch(/^# Idea pipeline \(2 ideas, idea MRR \$0\.00\)/)
    expect(t).toMatch(/## validate \(1\)\n- \*\*permitly\*\*: 1 visitor.*Launch posts logged: 1\. https:\/\/p\/permitly\//)
    expect(t).toMatch(/## pass \(1\)\n- x: Crowded\./)
    expect(t.indexOf('## validate')).toBeLessThan(t.indexOf('## pass'))
  })
  it('shows one idea with visitors by source and its launch posts', () => {
    const t = formatIdea(permitly, input({
      referrers: [{ slug: 'permitly', host: 'direct', visitors: 1 }, { slug: 'permitly', host: 'reddit.com', visitors: 4 }, { slug: 'other', host: 'x.com', visitors: 9 }],
      launchLogs: new Map([['permitly', { posts: [{ channel: 'r/airbnb_hosts', postUrl: 'https://reddit.com/r/airbnb_hosts/1', postedAt: '2026-10-11T10:00:00Z' }] }]]),
    }))
    expect(t).toMatch(/Visitors by source: reddit\.com 4, direct 1$/m)
    expect(t).not.toMatch(/x\.com/)
    expect(t).toMatch(/- 2026-10-11 r\/airbnb_hosts: https:\/\/reddit\.com\/r\/airbnb_hosts\/1/)
    expect(t).toMatch(/Full record: \/ih\/ideas\/permitly\//)
    expect(formatIdea(permitly, input())).toMatch(/none logged yet\. The `launch` skill drafts them/)
  })
  it('reads policy and launch logs from the idea home, tolerating missing or malformed files', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'ideas-'))
    expect(readValidationPolicy(home)).toBeNull()
    writeFileSync(path.join(home, 'policy.json'), JSON.stringify({ validation: policy }))
    expect(readValidationPolicy(home)?.minVisitorsToJudge).toBe(50)
    mkdirSync(path.join(home, 'ideas', 'a'), { recursive: true })
    expect(readLaunchLog(home, 'a')).toBeNull()
    writeFileSync(path.join(home, 'ideas', 'a', 'launch-log.json'), '{"posts": "nope"}')
    expect(readLaunchLog(home, 'a')).toBeNull()
    writeFileSync(path.join(home, 'ideas', 'a', 'launch-log.json'), JSON.stringify({ posts: [{ channel: 'HN', postedAt: '2026-10-11' }] }))
    expect(readLaunchLog(home, 'a')?.posts).toHaveLength(1)
  })
})
