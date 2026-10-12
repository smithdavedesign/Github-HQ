import { describe, it, expect } from 'vitest'
import { backlog, buildMorningReport, clip, heldReasons, inboxLines, latestScans, overnightLines, queueLines, rejectionLines, toMime, type ReportInput } from '../../factory/lib/report'
import type { AttemptEntry, LedgerEntry } from '../../factory/lib/ledger'

const NOW = new Date('2026-10-06T13:45:00Z')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString()

function att(p: Partial<AttemptEntry>): AttemptEntry {
  return {
    type: 'attempt', id: p.id ?? Math.random().toString(36).slice(2), runId: 'r', at: hoursAgo(2), repo: 'o/app', kind: 'fix-lint',
    taskTier: 2, tier: 'M1', model: 'free-agent', harness: 'claude-code', outcome: 'verified', reason: 'lint pass', exploring: false,
    durationMs: 600_000, costUsd: 0, inputTokens: 0, outputTokens: 0, ...p,
  }
}

type Audit = { critical: number; high: number; moderate: number; low: number } | null
const scan = (repo: string, tasks: string[], at = hoursAgo(3), checks: Record<string, boolean> = { typecheck: true, lint: false }, audit: Audit = null): LedgerEntry =>
  ({ type: 'scan', runId: 'r', at, repo, checks, tasks, audit })

function input(entries: LedgerEntry[], over: Partial<ReportInput> = {}): ReportInput {
  return {
    now: NOW, entries, repos: ['o/app', 'o/api'],
    pool: { 'free-agent': 'ollama-cloud:nemotron-3-super', 'free-agent-b': 'openrouter:x:free' },
    liteLLMUp: true, openRouterQuota: { remaining: 12, limit: 50 },
    copilot: { enabled: true, model: 'gpt-5-mini', tasksToday: 2, maxTasksPerDay: 6, reviewsToday: 1, maxReviewsPerDay: 8 },
    prTarget: { min: 3, max: 8 }, monthToDateUsd: 0, monthlyBudgetUsd: 0, cycles: [{ at: hoursAgo(5), exit: 0 }, { at: hoursAgo(4), exit: 1 }],
    ...over,
  }
}

describe('latestScans + backlog', () => {
  it('keeps the newest scan per allowlisted repo', () => {
    const entries = [scan('o/app', ['fix-lint'], hoursAgo(10)), scan('o/app', ['fix-tests'], hoursAgo(1)), scan('o/removed', ['fix-lint'])]
    expect(latestScans(entries, ['o/app']).map(s => s.tasks)).toEqual([['fix-tests']])
    expect(latestScans(entries).map(s => s.repo)).toEqual(['o/app', 'o/removed'])
  })
  it('drops kinds that already have an open PR and orders by value', () => {
    const entries = [
      scan('o/app', ['docs-readme', 'fix-lint', 'fix-types']),
      scan('o/api', ['deps-audit']),
      att({ id: 'a', repo: 'o/app', kind: 'fix-lint', prUrl: 'https://github.com/o/app/pull/1' }),
    ]
    expect(backlog(entries, ['o/app', 'o/api'])).toEqual([
      { repo: 'o/app', kind: 'fix-types' }, { repo: 'o/api', kind: 'deps-audit' }, { repo: 'o/app', kind: 'docs-readme' },
    ])
  })
  it('drops dead ends, which the cycle skips (2026-10-11: three dead deps fixes listed as next up)', () => {
    const dead = { repo: 'o/api', kind: 'deps-audit', tier: 'M0' as const, harness: 'npm-audit-fix', outcome: 'failed' as const }
    const entries = [scan('o/api', ['deps-audit', 'docs-readme']), att(dead), att(dead)]
    expect(backlog(entries, ['o/api'], NOW)).toEqual([{ repo: 'o/api', kind: 'docs-readme' }])
  })
  it('drops red CI from an old scan once newer signals show the branch green, and says "investigate" at stage report', () => {
    const sig = (redCi: unknown[]) => ({
      type: 'signals', runId: 'r', at: hoursAgo(1), repo: 'o/app', base: 'main', redCi,
      alerts: { status: 'ok', critical: 0, high: 0, medium: 0, low: 0, npmFixable: 0 }, botPrs: { open: 0, stale: [] },
    }) as unknown as LedgerEntry
    const red = { workflow: 'CI', runId: 1, url: 'u', headSha: 'a', at: '', conclusion: 'failure' }
    const old = scan('o/app', ['red-ci', 'fix-tests'], hoursAgo(48))
    expect(backlog([old, sig([])], ['o/app']).map(t => t.kind)).toEqual(['fix-tests'])
    expect(backlog([old, sig([red])], ['o/app']).map(t => t.kind)).toEqual(['red-ci', 'fix-tests'])
    const text = buildMorningReport(input([old, sig([red])], { capabilities: { 'red-ci': 'report' } as ReportInput['capabilities'] })).text
    expect(text).toMatch(/1\. app — investigate red CI \(report only, no PR\)/)
  })
})

describe('buildMorningReport', () => {
  const entries: LedgerEntry[] = [
    scan('o/app', ['fix-lint', 'docs-readme']),
    scan('o/api', ['deps-audit'], hoursAgo(3), { typecheck: true, lint: true, test: true }, { critical: 1, high: 2, moderate: 0, low: 0 }),
    att({ id: 'p1', prUrl: 'https://github.com/o/app/pull/7', reviewRequested: true }),
    att({ id: 'p2', repo: 'o/api', kind: 'deps-audit', tier: 'M0', harness: 'npm-audit-fix', model: 'npm', prUrl: 'https://github.com/o/api/pull/3', reviewRequested: true }),
    att({ id: 'f1', outcome: 'failed', tier: 'M0', reason: 'README deleted 4 existing lines' }),
    { type: 'review', attemptId: 'p1', at: hoursAgo(1), reviewer: 'copilot', comments: 2, highlights: [] },
  ]
  const r = buildMorningReport(input(entries))
  const section = (id: string) => r.sections.find(s => s.id === id)!

  it('has one section per gstack role, in order', () => {
    expect(r.sections.map(s => s.id)).toEqual(['pm', 'architect', 'builder', 'qa', 'reviewer', 'security', 'ops', 'retro'])
    expect(r.subject).toMatch(/2 PRs to review/)
  })
  it('PM hands the backlog to the Architect, flags below-target', () => {
    expect(section('pm').lines[0]).toBe('2 factory PRs open (overnight target 3–8) — below target.')
    expect(section('pm').lines.join('\n')).toContain('app — fill README gaps')
    expect(section('pm').lines.join('\n')).not.toContain('fix lint errors') // open PR already
  })
  it('Builder marks PRs that were already closed', () => {
    const closed = buildMorningReport(input([...entries, { type: 'resolution', attemptId: 'p2', at: hoursAgo(1), outcome: 'rejected' }]))
    expect(closed.sections.find(s => s.id === 'builder')!.lines.join('\n')).toContain('patch vulnerable dependencies (closed)')
  })
  it('Builder lists new PRs with tier and model; deps fixes show npm audit fix', () => {
    expect(section('builder').lines.join('\n')).toContain('https://github.com/o/app/pull/7')
    expect(section('builder').lines.join('\n')).toContain('M0 · npm audit fix')
  })
  it('QA calls out environment-dependent failures instead of tasking them', () => {
    const env: LedgerEntry = { type: 'scan', runId: 'r', at: hoursAgo(1), repo: 'o/api', checks: { test: false }, tasks: [], envFailures: ['test'] }
    const q = buildMorningReport(input([env])).sections.find(s => s.id === 'qa')!
    expect(q.lines.join('\n')).toContain('api: the test check needs secrets or network')
  })
  it('QA shows the check matrix and judge rejections', () => {
    expect(section('qa').lines).toContain('app: ✓ ✗ –')
    expect(section('qa').lines.join('\n')).toContain('README deleted 4 existing lines')
  })
  it('Reviewer reports Copilot results and pending reviews', () => {
    expect(section('reviewer').lines[0]).toBe('1 reviewed by Copilot, 0 by the local reviewer, 1 waiting, 0 not reviewed.')
    expect(section('reviewer').lines.join('\n')).toContain('2 line comments')
  })
  it('Reviewer counts the local stack\'s gstack /review when Copilot couldn\'t review', () => {
    const local = buildMorningReport(input([
      ...entries,
      att({ id: 'p3', repo: 'o/web', prUrl: 'https://github.com/o/web/pull/4' }),
      { type: 'review', attemptId: 'p3', at: hoursAgo(1), reviewer: 'local', comments: 2, highlights: ['critical: unparameterised SQL'] },
    ]))
    const lines = local.sections.find(s => s.id === 'reviewer')!.lines
    expect(lines[0]).toBe('1 reviewed by Copilot, 1 by the local reviewer, 1 waiting, 0 not reviewed.')
    expect(lines.join('\n')).toContain('web fix-lint: local review: 2 findings — https://github.com/o/web/pull/4')
  })
  it('Security lists high/critical advisories', () => {
    expect(section('security').lines.join('\n')).toContain('api: 1 critical, 2 high')
  })
  it('Ops reports gateway, cycles, quota and spend', () => {
    expect(section('ops').lines).toContain('Cycles in the last 24h: 2 (1 failed).')
    expect(section('ops').lines.join('\n')).toContain('12/50 left today')
  })
  it('adds model-written headlines only when provided', () => {
    const withH = buildMorningReport(input(entries, { headlines: { pm: 'Two PRs ready, three more queued.' } }))
    expect(withH.sections[0].lines[0]).toBe('“Two PRs ready, three more queued.”')
    expect(r.sections[0].lines[0]).not.toMatch(/^“/)
  })
  it('escapes HTML and links PRs', () => {
    expect(r.html).toContain('<a href="https://github.com/o/app/pull/7">o/app/pull/7</a>')
    expect(r.html).not.toMatch(/<script/i)
  })
  it('opens with Today when the growth loop has focus products, and puts Growth after Founder', () => {
    const ideas = [{ slug: 'tiebreak', title: 'tiebreak — polls', stage: 'building' as const, repo: 'https://github.com/o/tiebreak',
      launch: { steps: [], next: { id: 'payments', label: 'Stripe product created and mapped to the repo in RepoHQ', owner: 'david' as const }, done: 6, total: 10 } }]
    const growth = { focus: ['tiebreak'], minVisitorsPerWeek: 50, holdNewBuilds: true, kits: {}, logs: {} }
    const g = buildMorningReport(input(entries, { ideas, growth, openPrsAll: [] }))
    expect(g.sections.map(s => s.id).slice(0, 4)).toEqual(['today', 'inbox', 'ideas', 'growth'])
    expect(g.sections[0]!.lines[0]).toMatch(/^tiebreak, your step on the road to revenue: Stripe product/)
    expect(g.text).toMatch(/^RepoHQ factory .*\n\nTODAY \(growth loop\) — Your ten minutes, money first/)
  })
})

describe('Done overnight (autonomy)', () => {
  const pr7 = att({ id: 'a7', repo: 'o/app', kind: 'fix-lint', prUrl: 'https://github.com/o/app/pull/7' })
  const pr8 = att({ id: 'a8', repo: 'o/api', kind: 'deps-audit', prUrl: 'https://github.com/o/api/pull/8' })
  const pr9 = att({ id: 'a9', repo: 'o/api', kind: 'fix-types', prUrl: 'https://github.com/o/api/pull/9' })
  const entries: LedgerEntry[] = [
    pr7, pr8, pr9,
    { type: 'automerge', attemptId: 'a7', at: hoursAgo(5), action: 'merged', reason: '2 checks green, preview smoke passed', sha: 's7', base: 'main' },
    { type: 'automerge', attemptId: 'a8', at: hoursAgo(4), action: 'merged', reason: '1 check green', sha: 's8', base: 'main' },
    { type: 'postmerge', attemptId: 'a8', at: hoursAgo(3), sha: 's8', passed: false, reason: 'CI failed on main after it merged, and passed before it', revertUrl: 'https://github.com/o/api/pull/10', revertSha: 'r10' },
    { type: 'postmerge', attemptId: 'a8', at: hoursAgo(2), sha: 'r10', passed: true, revert: true, reason: 'main is green again after the revert' },
    { type: 'automerge', attemptId: 'a9', at: hoursAgo(1), action: 'held', reason: 'CI failed' },
    { type: 'automerge', attemptId: 'a7', at: hoursAgo(40), action: 'merged', reason: 'yesterday', sha: 'old', base: 'main' },
  ]
  const ideas = [
    { slug: 'tiebreak', title: 'tiebreak — polls', stage: 'live' as const, repo: 'https://github.com/o/tiebreak',
      build: { milestone: 'GROWTH', kind: 'seo', status: 'merged' as const, prUrl: 'https://github.com/o/tiebreak/pull/12', mergedBy: 'agent' as const, mergedAt: hoursAgo(6) },
      growth: { experiments: [
        { id: 'tiebreak-1', kind: 'landing', executor: 'build' as const, hypothesis: 'h', metric: 'activate' as const, baseline: 0.2, target: 0.3, windowDays: 14, status: 'decided' as const, createdAt: hoursAgo(400),
          decision: 'revert' as const, decidedAt: hoursAgo(7), result: { lift: false, value: 0.05, before: 0.2, sample: 100 }, reverted: { at: hoursAgo(7), url: 'https://github.com/o/tiebreak/pull/13' } },
        { id: 'tiebreak-2', kind: 'seo', executor: 'build' as const, hypothesis: 'h', metric: 'visit' as const, baseline: 3, target: 50, windowDays: 28, status: 'abandoned' as const, createdAt: hoursAgo(30),
          updatedAt: hoursAgo(8), failed: true, reason: 'web failed', prUrl: 'https://github.com/o/tiebreak/pull/11' },
      ] } },
    { slug: 'dawnlog', title: 'dawnlog — journal', stage: 'building' as const, repo: 'https://github.com/o/dawnlog',
      build: { milestone: 'GOLIVE', status: 'merged' as const, prUrl: 'https://github.com/o/dawnlog/pull/3', mergedBy: 'agent' as const, mergedAt: hoursAgo(9),
        reverted: { at: hoursAgo(8), url: 'https://github.com/o/dawnlog/pull/4', reason: "the live site's launch checks failed after it merged (missing Terms page)" } } },
  ]
  it('lists what the agents merged, reverted and judged in the last day', () => {
    expect(overnightLines(entries, ideas, NOW)).toEqual([
      '4 PRs merged by the agents, 2 reverted, 2 experiments judged or closed.',
      'Merged app#7 · fix lint errors: 2 checks green, preview smoke passed — https://github.com/o/app/pull/7',
      'Merged api#8 · patch vulnerable dependencies: 1 check green (reverted since, below) — https://github.com/o/api/pull/8',
      'Merged tiebreak · Growth build (search pages) — https://github.com/o/tiebreak/pull/12',
      'Merged dawnlog · Go-live (reverted since, below) — https://github.com/o/dawnlog/pull/3',
      'Reverted api#8: CI failed on main after it merged, and passed before it — https://github.com/o/api/pull/10',
      "Reverted dawnlog · Go-live: the live site's launch checks failed after it merged (missing Terms page) — https://github.com/o/dawnlog/pull/4",
      'Experiment judged · tiebreak: first screen · decided: revert (reverted) · 20.0% of visitors → 5.0% of visitors (target 30.0% of visitors) — reverted: https://github.com/o/tiebreak/pull/13',
      "Closed tiebreak's growth PR (web failed); the mission is tried again the next day — https://github.com/o/tiebreak/pull/11",
    ])
  })
  it('calls out a merge that broke main and could not be undone, or a main still red after a revert', () => {
    const broke: LedgerEntry[] = [pr8, { type: 'postmerge', attemptId: 'a8', at: hoursAgo(3), sha: 's8', passed: false, reason: 'CI failed on main', revertUrl: null, revertSha: null, revertError: 'git push failed: denied' }]
    expect(overnightLines(broke, [], NOW)[1]).toBe("api#8 broke its base branch (CI failed on main) and wasn't reverted (git push failed: denied): needs you — https://github.com/o/api/pull/8")
    const still: LedgerEntry[] = [pr8, { type: 'postmerge', attemptId: 'a8', at: hoursAgo(2), sha: 'r10', passed: false, revert: true, reason: 'CI still fails on main after the revert' }]
    expect(overnightLines(still, [], NOW)[1]).toBe('api#8: CI still fails on main after the revert. Needs you.')
  })
  it('comes first in the email, and says so when the agents did nothing', () => {
    const autonomy = { merge: true, revert: true, protectedPaths: ['factory/'] }
    const r = buildMorningReport(input(entries, { ideas, autonomy }))
    expect(r.sections[0]!.id).toBe('overnight')
    expect(r.text).toMatch(/^RepoHQ factory .*\n\nDONE OVERNIGHT \(autonomy: agents merge their own green PRs and revert what breaks\) — What the agents did on their own \(last 24h\)\n  4 PRs merged/)
    expect(buildMorningReport(input([], { autonomy })).sections[0]!.lines).toEqual(['Nothing merged, reverted or decided by the agents in the last 24 hours.'])
    expect(buildMorningReport(input([])).sections.map(s => s.id)).not.toContain('overnight')
  })
  it("says in the review queue why the factory didn't merge a PR, and states the policy", () => {
    const prs = [{ repo: 'o/api', number: 9, title: 'fix types', url: 'https://github.com/o/api/pull/9', author: 'app/repohq-factory', createdAt: new Date(hoursAgo(2)), isDraft: true, labels: [] }]
    expect(inboxLines(prs, [pr9], new Map(), NOW, 'me', heldReasons(entries))[1]).toMatch(/^api#9 · 0d · factory · fix type errors \(M1\) \[not merged: CI failed, draft\]/)
    const sec = buildMorningReport(input([], { autonomy: { merge: true, revert: true, protectedPaths: ['factory/', '.github/workflows/'] } })).sections.find(s => s.id === 'security')!
    expect(sec.lines.at(-1)).toBe('Policy in force: private repos never go to free-cloud models; the factory merges its own PRs only when every check is green and nothing objected, reverts a merge that turns the base branch red, leaves PRs touching factory/, .github/workflows/ to you, and never force-pushes or deletes.')
  })
})

describe('toMime', () => {
  it('builds a multipart/alternative message with base64 parts and an encoded subject', () => {
    const r = buildMorningReport(input([]))
    const mime = toMime(r, 'me@example.com', 'me@example.com', NOW)
    expect(mime).toContain('From: RepoHQ Factory <me@example.com>')
    expect(mime).toContain('Content-Type: multipart/alternative')
    expect(mime).toMatch(/Subject: (=\?UTF-8\?B\?|RepoHQ)/)
    const text = mime.split('Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n')[1].split('\r\n--')[0]
    expect(Buffer.from(text.replace(/\r\n/g, ''), 'base64').toString()).toContain('PRODUCT MANAGER')
  })
})

describe('report wording', () => {
  it('clips at a sentence or word, never mid-word', () => {
    expect(clip('short', 10)).toBe('short')
    expect(clip('The smoke tests run in npm test. They need API keys the job lacks.', 50)).toBe('The smoke tests run in npm test.')
    expect(clip('The smoke integration tests need NPS_API_KEY and DATABASE_URL which are', 40)).toBe('The smoke integration tests need…')
  })
  it('lists idle repos apart from the queue', () => {
    const o = (repo: string, reasons: string[], blocked: string | null = null) => ({ repo, score: 1, reasons, blocked })
    expect(queueLines([o('o/a', ['77 high/critical alerts']), o('o/b', ['every known task has an open PR or is a dead end']), o('o/c', [], 'stale')])).toEqual([
      'Repo queue for the next cycle: a (77 high/critical alerts).',
      'Waiting on your PR reviews or dead ends, nothing to do: b.',
    ])
  })
  it('folds repeated rejections and counts the ones not shown', () => {
    const r = (reason: string, kind = 'docs-readme') => att({ outcome: 'failed', kind, tier: 'M0', reason })
    const lines = rejectionLines([r('README did not grow'), r('README did not grow'), r('a'), r('b'), r('c')], 3)
    expect(lines).toEqual([
      '5 attempts rejected by the judge or failed to run:',
      'app docs-readme (M0): README did not grow ×2', 'app docs-readme (M0): a', 'app docs-readme (M0): b',
      '…and 1 more (see the ledger).',
    ])
  })
  it('says Copilot reviews are paused when premium requests are used up', () => {
    const text = buildMorningReport(input([], { copilot: { enabled: true, model: 'm', tasksToday: 0, maxTasksPerDay: 6, reviewsToday: 0, maxReviewsPerDay: 8, quota: { percentRemaining: 0, resetDate: '2026-11-01' } } as ReportInput['copilot'] })).text
    expect(text).toMatch(/Copilot reviews: paused until 2026-11-01/)
    expect(text).not.toMatch(/Copilot reviews today/)
  })
})

describe('factoryCantFixOf', () => {
  it('names dead-ended fixes and capabilities that only report', async () => {
    const { factoryCantFixOf } = await import('../../factory/lib/report')
    const dead = new Set(['o/family-tree:deps-audit'])
    expect(factoryCantFixOf('o/family-tree', dead, { 'deps-audit': 'pr', 'red-ci': 'report' })).toEqual({
      'deps-audit': 'its dependency fixes failed twice: see QA for why',
      'red-ci': 'red-CI fixes are at "report", not "pr", so it only reports',
    })
    expect(factoryCantFixOf('o/app', dead, { 'deps-audit': 'pr', 'red-ci': 'pr' })).toEqual({})
  })
})
