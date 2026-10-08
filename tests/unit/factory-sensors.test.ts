import { describe, expect, it } from 'vitest'
import { AGE_POINTS_PER_DAY, failingRuns, parseBotPrs, parseDependabotAlerts, rankOpportunities, WEIGHTS } from '../../factory/lib/sensors'
import { investigationPrompt, parseFindings, redCiTask, PIPELINES } from '../../factory/lib/tasks'
import { buildMorningReport, type ReportInput } from '../../factory/lib/report'
import { capabilityStatus } from '../../factory/lib/ladder'
import { latestSignals, pendingCiOracles, type LedgerEntry, type SignalsEntry } from '../../factory/lib/ledger'

const now = new Date('2026-10-20T12:00:00Z')
const runEntry = (workflowName: string, conclusion: string | null, createdAt: string, status = 'completed') =>
  ({ databaseId: createdAt.length, workflowName, conclusion, status, createdAt, url: `https://github.com/o/r/actions/runs/${createdAt.length}`, headSha: 'abc' })
const signals = (repo: string, over: Partial<SignalsEntry> = {}): SignalsEntry => ({
  type: 'signals', runId: 'r', at: '2026-10-20T03:00:00Z', repo, base: 'main', redCi: [],
  alerts: { status: 'disabled', critical: 0, high: 0, medium: 0, low: 0, npmFixable: 0 }, botPrs: { open: 0, stale: [] }, ...over,
})
const scan = (repo: string, tasks: string[], at = '2026-10-19T03:00:00Z'): LedgerEntry => ({ type: 'scan', runId: 'r', at, repo, checks: {}, tasks })

describe('CI sensor', () => {
  it('keeps the latest completed run per workflow and reports the failing ones', () => {
    const runs = [
      runEntry('CI', 'failure', '2026-10-18T00:00:00Z'), runEntry('CI', 'success', '2026-10-19T00:00:00Z'),
      runEntry('Deploy', 'success', '2026-10-17T00:00:00Z'), runEntry('Deploy', 'failure', '2026-10-19T01:00:00Z'),
      runEntry('Lint', 'timed_out', '2026-10-19T02:00:00Z'), runEntry('Lint', null, '2026-10-20T00:00:00Z', 'in_progress'),
      runEntry('Docs', 'cancelled', '2026-10-19T00:00:00Z'),
    ]
    expect(failingRuns(runs, new Date('2026-10-20T12:00:00Z')).map(r => `${r.workflow}:${r.conclusion}`)).toEqual(['Deploy:failure', 'Lint:timed_out'])
  })
  it('a failure older than 30 days with no newer run is history, not red CI', () => {
    const runs = [runEntry('Pages', 'failure', '2026-06-02T17:00:00Z'), runEntry('CI', 'failure', '2026-10-01T00:00:00Z')]
    expect(failingRuns(runs, new Date('2026-10-08T12:00:00Z')).map(r => r.workflow)).toEqual(['CI'])
  })
})

describe('security alerts sensor', () => {
  it('reads disabled/unavailable from the API error', () => {
    expect(parseDependabotAlerts(1, 'gh: Dependabot alerts are disabled for this repository. (HTTP 403)').status).toBe('disabled')
    expect(parseDependabotAlerts(1, 'HTTP 404').status).toBe('unavailable')
    expect(parseDependabotAlerts(0, 'not json').status).toBe('unavailable')
  })
  it('counts severities and npm-fixable alerts', () => {
    const json = JSON.stringify([
      { security_vulnerability: { severity: 'critical', package: { ecosystem: 'npm' }, first_patched_version: { identifier: '1.2.3' } } },
      { security_vulnerability: { severity: 'high', package: { ecosystem: 'pip' }, first_patched_version: { identifier: '2.0' } } },
      { security_vulnerability: { severity: 'high', package: { ecosystem: 'npm' }, first_patched_version: null } },
    ])
    expect(parseDependabotAlerts(0, json)).toEqual({ status: 'ok', critical: 1, high: 2, medium: 0, low: 0, npmFixable: 1 })
  })
})

describe('bot PR sensor', () => {
  it('flags only autonomous PRs open 7+ days with no review', () => {
    const prs = [
      { number: 1, url: 'u1', headRefName: 'nexus/agent-task-1', createdAt: '2026-10-05T00:00:00Z' },
      { number: 2, url: 'u2', headRefName: 'feature/bot/factory-x', createdAt: '2026-10-18T00:00:00Z' },
      { number: 3, url: 'u3', headRefName: 'factory/old', createdAt: '2026-10-01T00:00:00Z', latestReviews: [{}] },
      { number: 4, url: 'u4', headRefName: 'feature/human-thing', createdAt: '2026-09-01T00:00:00Z' },
    ]
    expect(parseBotPrs(prs, now)).toEqual({ open: 3, stale: [{ number: 1, url: 'u1', ageDays: 15 }] })
  })
})

describe('opportunity queue', () => {
  const repos = ['o/docs', 'o/red', 'o/types', 'o/new', 'o/stale']
  const entries: LedgerEntry[] = [scan('o/docs', ['docs-readme']), scan('o/red', []), scan('o/types', ['fix-types']), scan('o/stale', ['fix-types'])]
  const sig = [signals('o/red', { redCi: [{ workflow: 'CI', runId: 1, url: 'u', headSha: 'a', at: '', conclusion: 'failure' }] }), signals('o/stale', { botPrs: { open: 1, stale: [{ number: 9, url: 'u9', ageDays: 10 }] } })]
  it('ranks red CI > failing checks > never scanned > docs, and puts blocked repos last', () => {
    const ranked = rankOpportunities(repos, entries, sig, now, { blockOnStalePrs: true })
    expect(ranked.map(o => o.repo)).toEqual(['o/red', 'o/types', 'o/new', 'o/docs', 'o/stale'])
    expect(ranked.at(-1)!.blocked).toMatch(/1 stale bot PR/)
    expect(rankOpportunities(repos, entries, sig, now).find(o => o.repo === 'o/stale')!.blocked).toBeNull()
  })
  it('a low health score raises priority within the same category', () => {
    const health = new Map([['o/types', 90], ['o/stale', 20]])
    const ranked = rankOpportunities(['o/types', 'o/stale'], entries, [], now, { health })
    expect(ranked[0].repo).toBe('o/stale')
  })
  it('clean repos come round again as their last scan ages', () => {
    const fresh = rankOpportunities(['o/a'], [scan('o/a', [], '2026-10-20T11:00:00Z')], [], now)[0].score
    const old = rankOpportunities(['o/a'], [scan('o/a', [], '2026-10-14T11:00:00Z')], [], now)[0].score
    expect(old).toBeGreaterThan(fresh)
    expect(WEIGHTS.redCi).toBeGreaterThan(WEIGHTS.security)
    // The age bonus can never lift a repo into the next category.
    const weights = Object.values(WEIGHTS).sort((a, b) => a - b)
    const minGap = Math.min(...weights.slice(1).map((w, i) => w - weights[i]))
    expect(7 * AGE_POINTS_PER_DAY).toBeLessThan(minGap)
  })
})

describe('red-ci pipeline', () => {
  const t = redCiTask({ workflow: 'CI', url: 'https://github.com/o/r/actions/runs/1', conclusion: 'failure' }, 'main', 'Error: build failed')
  it('builds a fix task with the workflow as its oracle', () => {
    expect(t).toMatchObject({ kind: 'red-ci', verify: [], ci: { workflow: 'CI', base: 'main' } })
    expect(t.objective).toMatch(/\.github\/ can't be changed/)
    expect(PIPELINES['red-ci']).toMatch(/oracle/)
  })
  it('investigation prompt is read-only and asks for a structured report', () => {
    const p = investigationPrompt(t)
    expect(p).toMatch(/Do NOT modify any files/)
    expect(p).toContain('Error: build failed')
    for (const h of ['## Root cause', '## Evidence', '## Proposed fix', '## Confidence']) expect(p).toContain(h)
  })
  it('parses findings only when the report has a root cause and a proposed fix', () => {
    const report = 'Looked around.\n## Root cause\nThe build imports a file that was renamed in a1b2c3.\n## Evidence\nsrc/a.ts:3\n## Proposed fix\nUpdate the import path.\n## Confidence\nhigh'
    expect(parseFindings(report)).toMatch(/^## Root cause/)
    expect(parseFindings('## Root cause\nunknown')).toBeNull()
    expect(parseFindings('no report')).toBeNull()
  })
})

describe('ledger helpers', () => {
  it('latestSignals keeps the newest per repo; pendingCiOracles lists open red-ci PRs without a result', () => {
    const entries: LedgerEntry[] = [signals('o/a', { at: '2026-10-19T00:00:00Z' }), signals('o/a', { at: '2026-10-20T00:00:00Z', base: 'integration/agent' })]
    expect(latestSignals(entries).get('o/a')!.base).toBe('integration/agent')
    const att = { type: 'attempt', id: 'x', runId: 'r', at: '', repo: 'o/a', kind: 'red-ci', taskTier: 2, tier: 'M1', model: 'm', harness: 'claude-code', outcome: 'verified', reason: '', exploring: false, durationMs: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, prUrl: 'u', ciWorkflow: 'CI' } as const
    expect(pendingCiOracles([att]).map(a => a.id)).toEqual(['x'])
    expect(pendingCiOracles([att, { type: 'ci_oracle', attemptId: 'x', at: '', workflow: 'CI', passed: true }])).toEqual([])
  })
})

describe('morning report sensor lines', () => {
  const base: ReportInput = {
    now, entries: [], repos: ['o/red', 'o/stale'], pool: {}, liteLLMUp: true, openRouterQuota: null,
    copilot: { enabled: false, model: 'm', tasksToday: 0, maxTasksPerDay: 6, reviewsToday: 0, maxReviewsPerDay: 8 },
    prTarget: { min: 3, max: 8 }, monthToDateUsd: 0, monthlyBudgetUsd: 0, cycles: [],
  }
  it('shows red CI with the investigated root cause, disabled Dependabot and stale bot PRs', () => {
    const inv = { type: 'attempt', id: 'i', runId: 'r', at: '2026-10-20T03:00:00Z', repo: 'o/red', kind: 'red-ci', taskTier: 2, tier: 'M1', model: 'free-agent', harness: 'claude-code', outcome: 'verified', reason: '', exploring: false, durationMs: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, reported: true, findings: '## Root cause\nNode 18 in the workflow but the code needs 20.\n## Proposed fix\nbump' } as const
    const r = buildMorningReport({ ...base, entries: [
      signals('o/red', { redCi: [{ workflow: 'CI', runId: 1, url: 'u', headSha: 'a', at: '', conclusion: 'failure' }] }),
      signals('o/stale', { botPrs: { open: 1, stale: [{ number: 9, url: 'https://github.com/o/stale/pull/9', ageDays: 10 }] } }),
      inv,
    ] })
    const text = r.text
    expect(text).toMatch(/red \(main\): CI — root cause: Node 18 in the workflow/)
    expect(text).toMatch(/Dependabot alerts are disabled on 2 of 2 repos/)
    expect(text).toMatch(/stale: 1 bot PR unreviewed for 7\+ days/)
    expect(text).toMatch(/Repo queue for the next cycle: red \(red CI: CI\)/)
  })
  it('security-alerts is a sensor in the ladder: never promoted to PRs', () => {
    expect(capabilityStatus('security-alerts', 'report', [signals('o/a')], now)).toMatchObject({ advice: 'hold', next: expect.stringMatching(/enable Dependabot/) })
  })
})
