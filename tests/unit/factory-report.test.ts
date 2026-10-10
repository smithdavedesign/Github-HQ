import { describe, it, expect } from 'vitest'
import { backlog, buildMorningReport, latestScans, toMime, type ReportInput } from '../../factory/lib/report'
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
