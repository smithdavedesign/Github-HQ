/**
 * Agent HQ requests (roadmap Phase 81, docs/agent-hq-migration-prd.md §5–§8): the pure parts
 * shared by RepoHQ, the MCP server and the factory worker, the factory's outcome records, and
 * the trace protocol between the worker and the cycles it spawns.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  OPEN_REQUEST_STATUSES, SKILL_MODES, findingsFromReport, isAllowlisted, isOpenRequestStatus, modeForSkill,
  newRequestRow, pickWeeklySkillRepos, queuedEventValues, requestStatusLabel, stageForRequest, MAX_OBJECTIVE_CHARS,
} from '@/lib/agents/factory-request-utils'
import { BLOCKING_STAGES, TERMINAL_STAGES } from '@/lib/agents/lifecycle-utils'
import { requestOutcomeRecords, resolvedFromRow, toOwnerRequest } from '../../factory/lib/agent-requests'
import { ownerOutcome } from '../../factory/lib/owner-requests'
import { Tracer, formatProtocolLine, parseProtocolLine, RESULT_PREFIX, TRACE_PREFIX } from '../../factory/lib/trace'
import { splitStatements } from '../../factory/bin/migrate'
import type { AttemptEntry, LedgerEntry } from '../../factory/lib/ledger'

const now = new Date('2026-10-07T10:00:00Z')

describe('skills → request modes (PRD §8)', () => {
  it('fix skills open PRs, report skills come back as findings, canary has no factory equivalent', () => {
    expect(modeForSkill('ship')).toBe('fix')
    expect(modeForSkill('qa')).toBe('fix')
    expect(modeForSkill('document-release')).toBe('fix')
    for (const s of ['review', 'qa-only', 'health', 'investigate', 'retro'] as const) expect(modeForSkill(s)).toBe('report')
    expect(modeForSkill('canary')).toBeNull()
    expect(Object.keys(SKILL_MODES)).toHaveLength(9)
  })
})

describe('request status → lifecycle stage (PRD §7)', () => {
  it('open requests block a new one on the repo; resolved ones do not', () => {
    expect(BLOCKING_STAGES.has(stageForRequest('queued'))).toBe(true)
    expect(BLOCKING_STAGES.has(stageForRequest('running'))).toBe(true)
    expect(BLOCKING_STAGES.has(stageForRequest('pr'))).toBe(true) // pr_ready until merged/closed
    for (const s of ['verified', 'reported', 'rejected', 'failed', 'cancelled']) {
      expect(TERMINAL_STAGES.has(stageForRequest(s))).toBe(true)
    }
    expect(stageForRequest('verified')).toBe('verified')
    expect(stageForRequest('reported')).toBe('report_ready')
    expect(stageForRequest('rejected')).toBe('failed')
    expect(stageForRequest('cancelled')).toBe('idle')
    expect(stageForRequest('something-new')).toBe('idle')
  })

  it('open statuses and labels', () => {
    expect(OPEN_REQUEST_STATUSES).toEqual(['queued', 'running'])
    expect(isOpenRequestStatus('running')).toBe(true)
    expect(isOpenRequestStatus('pr')).toBe(false)
    expect(requestStatusLabel('verified')).toMatch(/held/)
    expect(requestStatusLabel('mystery')).toBe('mystery')
  })
})

describe('new request rows and their queued event', () => {
  const base = { id: 'req-1', userId: 'u1', repoId: 7, repo: 'o/r', mode: 'fix' as const, skill: 'ship' as const, objective: '  add a dark mode toggle  ', source: 'ui-skill' as const, now }

  it('starts queued, trims and caps the objective', () => {
    const row = newRequestRow(base)
    expect(row).toMatchObject({ id: 'req-1', status: 'queued', objective: 'add a dark mode toggle', skill: 'ship', createdAt: now })
    expect(newRequestRow({ ...base, objective: 'x'.repeat(10_000) }).objective).toHaveLength(MAX_OBJECTIVE_CHARS)
  })

  it('the queued event carries the request id as taskId (what lifecycle, accuracy and PR detection key on)', () => {
    const e = queuedEventValues(base, 'Queued: dark mode', { impactType: 'health', predictedDelta: '+5' })
    expect(e.eventType).toBe('agent_task_queued')
    expect(e.metadata).toMatchObject({ taskId: 'req-1', executor: 'factory', mode: 'fix', source: 'ui-skill', skillName: 'ship', impactType: 'health' })
  })

  it('allowlist matching is case-insensitive', () => {
    expect(isAllowlisted('SmithDaveDesign/Github-HQ', ['smithdavedesign/github-hq'])).toBe(true)
    expect(isAllowlisted('someone/else', ['smithdavedesign/github-hq'])).toBe(false)
  })
})

describe('pickWeeklySkillRepos (the weekly /retro and /health runs)', () => {
  const repo = (id: number, name: string, opts: { focused?: boolean; archived?: boolean; pushedDaysAgo?: number } = {}) => ({
    id, name, fullName: `me/${name}`, isFocused: opts.focused ?? false, isArchived: opts.archived ?? false,
    lastPush: opts.pushedDaysAgo === undefined ? null : new Date(now.getTime() - opts.pushedDaysAgo * 86_400_000),
  })
  const allowlist = ['me/a', 'me/b', 'me/c', 'me/d', 'me/archived']

  it('only picks repos the factory takes work for, so none is refused at enqueue', () => {
    const repos = [repo(1, 'off-list-1'), repo(2, 'off-list-2'), repo(3, 'off-list-3'), repo(4, 'a', { pushedDaysAgo: 1 })]
    expect(pickWeeklySkillRepos(repos, allowlist, 3).map(r => r.name)).toEqual(['a'])
  })

  it('focused repos first, then the most recently pushed; archived ones never', () => {
    const repos = [
      repo(1, 'a', { pushedDaysAgo: 9 }), repo(2, 'b', { pushedDaysAgo: 1 }), repo(3, 'c'),
      repo(4, 'd', { focused: true, pushedDaysAgo: 30 }), repo(5, 'archived', { focused: true, archived: true }),
    ]
    expect(pickWeeklySkillRepos(repos, allowlist, 3).map(r => r.name)).toEqual(['d', 'b', 'a'])
    expect(pickWeeklySkillRepos(repos, allowlist, 10).map(r => r.name)).toEqual(['d', 'b', 'a', 'c'])
  })
})

describe('findingsFromReport', () => {
  it('takes the bullets of the Findings section only', () => {
    const report = [
      '## Summary', 'Two problems.', '',
      '## Findings', '- src/a.ts:12 — unchecked null', '* src/b.ts:3 — secret in code', '1. README: wrong command', '',
      '## Suggested next step', '- queue /ship to fix a.ts',
    ].join('\n')
    expect(findingsFromReport(report)).toEqual(['src/a.ts:12 — unchecked null', 'src/b.ts:3 — secret in code', 'README: wrong command'])
  })

  it('is empty without a Findings section', () => {
    expect(findingsFromReport(null)).toEqual([])
    expect(findingsFromReport('## Root cause\nx')).toEqual([])
  })
})

describe('factory side: rows → owner tasks → outcome records', () => {
  const row = { id: 'req-9', repo: 'o/r', repoId: 3, objective: 'review auth', source: 'ui-skill', mode: 'report', skill: 'review', createdAt: now }

  it('a stored request becomes an owner task with its mode and skill', () => {
    expect(toOwnerRequest(row)).toEqual({ taskId: 'req-9', repo: 'o/r', task: 'review auth', source: 'ui-skill', requestedAt: now.toISOString(), mode: 'report', skill: 'review', stored: true })
    expect(toOwnerRequest({ ...row, mode: 'weird', skill: null }).mode).toBe('fix')
  })

  const attempts = (...over: Partial<AttemptEntry>[]): LedgerEntry[] => over.map((o, i) => ({
    type: 'attempt', id: `a${i}`, runId: 'r', at: 't', repo: 'o/r', kind: 'owner-report', taskTier: 2, tier: 'M1', model: 'm',
    harness: 'claude-code', outcome: 'verified', reason: '', exploring: false, durationMs: 1, costUsd: 0, inputTokens: 0,
    outputTokens: 0, ownerTaskId: 'req-9', ...o,
  }) as AttemptEntry)

  it("ownerOutcome: 'reported' carries the findings report", () => {
    const o = ownerOutcome({ ownerTaskId: 'req-9', result: 'reported', ledger: attempts({ findings: '## Findings\n- a' , reason: 'investigated' }) })
    expect(o).toEqual({ status: 'reported', findings: '## Findings\n- a', reason: 'investigated' })
    expect(ownerOutcome({ ownerTaskId: 'req-9', result: 'deferred', ledger: [] })).toBeNull()
  })

  const req = resolvedFromRow(row)

  it('pr → agent_pr_created (taskId = request id, prUrl) + a PR-ready notification', () => {
    const r = requestOutcomeRecords('u1', { ...req, mode: 'fix', skill: 'ship' }, { status: 'pr', prUrl: 'https://github.com/o/r/pull/5' }, 'run-1')
    expect(r.events).toHaveLength(1)
    expect(r.events[0]).toMatchObject({ eventType: 'agent_pr_created', repoId: 3, metadata: { taskId: 'req-9', prUrl: 'https://github.com/o/r/pull/5', executor: 'factory' } })
    expect(r.notifications[0]).toMatchObject({ eventType: 'agent_pr_ready' })
  })

  it('reported → agent_skill_report with the parsed findings list', () => {
    const r = requestOutcomeRecords('u1', req, { status: 'reported', findings: '## Findings\n- src/x.ts:1 — bug\n## Suggested next step\n- ship' }, 'run-1')
    expect(r.events[0]).toMatchObject({ eventType: 'agent_skill_report', metadata: { taskId: 'req-9', skillName: 'review', findings: ['src/x.ts:1 — bug'], outcome: 'no-changes' } })
    expect(r.notifications).toEqual([])
  })

  it('rejected / failed → agent_execution_failed with the reason + a failure notification', () => {
    const r = requestOutcomeRecords('u1', req, { status: 'rejected', reason: 'diff too large' }, 'run-1')
    expect(r.events[0]).toMatchObject({ eventType: 'agent_execution_failed', description: 'diff too large', metadata: { requestStatus: 'rejected' } })
    expect(r.notifications[0]).toMatchObject({ eventType: 'agent_failed' })
  })

  it('verified writes nothing extra (lifecycle reads the row)', () => {
    expect(requestOutcomeRecords('u1', req, { status: 'verified', reason: 'held' }, 'run-1')).toEqual({ events: [], notifications: [] })
  })
})

describe('trace protocol (worker ↔ cycle child process)', () => {
  it('round-trips trace and result lines; ignores plain log text', () => {
    const t = { at: now.toISOString(), step: 'clone', status: 'ok' as const, durationMs: 1200 }
    expect(parseProtocolLine(formatProtocolLine(TRACE_PREFIX, t))).toEqual({ kind: 'trace', value: t })
    expect(parseProtocolLine(formatProtocolLine(RESULT_PREFIX, { status: 'deferred', reason: 'quota' }))).toEqual({ kind: 'result', value: { status: 'deferred', reason: 'quota' } })
    expect(parseProtocolLine('[factory 10:00:00] o/r: cloning')).toBeNull()
    expect(parseProtocolLine('::trace::{not json')).toBeNull()
    expect(parseProtocolLine('::result::{"nostatus":1}')).toBeNull()
  })

  it('Tracer prints steps (with the request id) and spans record duration and failures', async () => {
    const lines: string[] = []
    const tracer = new Tracer(null, null, 'req-1', l => lines.push(l))
    tracer.step('claimed', 'info', 'x'.repeat(2_000))
    await tracer.span('checks', async () => 3, n => ({ detail: `${n} checks`, data: { n } }))
    await expect(tracer.span('clone', async () => { throw new Error('boom') })).rejects.toThrow('boom')
    await tracer.flush()
    const parsed = lines.map(l => parseProtocolLine(l)?.value as { step: string; status: string; detail?: string; requestId?: string; durationMs?: number })
    expect(parsed.map(p => `${p.step}:${p.status}`)).toEqual(['claimed:info', 'checks:start', 'checks:ok', 'clone:start', 'clone:fail'])
    expect(parsed[0].detail).toHaveLength(1_000)
    expect(parsed[0].requestId).toBe('req-1')
    expect(parsed[2].detail).toBe('3 checks')
    expect(typeof parsed[2].durationMs).toBe('number')
    expect(parsed[4].detail).toBe('boom')
  })
})

describe('factory:migrate 0002 (Agent HQ queue)', () => {
  it('is idempotent statement by statement', () => {
    const stmts = splitStatements(readFileSync(path.resolve(__dirname, '../../factory/sql/0002_agent_hq_queue.sql'), 'utf8'))
    expect(stmts).toHaveLength(15)
    expect(stmts.filter(s => s.startsWith('CREATE TABLE IF NOT EXISTS'))).toHaveLength(3)
    expect(stmts.filter(s => /^DO \$\$[\s\S]*END \$\$;$/.test(s))).toHaveLength(4)
    expect(stmts.every(s => /IF NOT EXISTS/.test(s))).toBe(true)
  })
})

describe('report-mode tasks (owner-report)', () => {
  it('is an unscoped read-only task that carries the request id and skill', async () => {
    const { ownerReportTask, reportPrompt, PIPELINES } = await import('../../factory/lib/tasks')
    const t = ownerReportTask('o/r', '  audit the auth flow  ', 'req-1', 'review')
    expect(t).toMatchObject({ kind: 'owner-report', scoped: false, ownerTaskId: 'req-1', skill: 'review', objective: 'audit the auth flow' })
    expect(t.title).toMatch(/^\/review: /)
    expect(PIPELINES['owner-report']).toMatch(/no PR/)
    const p = reportPrompt(t, 'o/r')
    expect(p).toMatch(/senior reviewer/) // the review skill's focus
    expect(p).toContain('audit the auth flow')
    expect(p).toMatch(/Do NOT modify any files/)
    expect(p).toMatch(/## Findings/)
  })

  it('parseReport keeps the report from its Summary heading and needs a Findings section', async () => {
    const { parseReport } = await import('../../factory/lib/tasks')
    const text = 'I looked around.\n## Summary\nTwo issues in auth.\n## Findings\n- src/auth.ts:10 — token logged\n## Suggested next step\n- redact it'
    expect(parseReport(text)).toMatch(/^## Summary/)
    expect(parseReport('## Summary\nno findings heading here at all, just prose that is long enough')).toBeNull()
    expect(parseReport('nothing structured')).toBeNull()
  })

  it('fix skills add their guidance; document-release stays docs-only', async () => {
    const { ownerRequestedTask } = await import('../../factory/lib/tasks')
    expect(ownerRequestedTask('o/r', 'refresh the docs', 'req-2', 'document-release').objective).toMatch(/Documentation files only/)
    expect(ownerRequestedTask('o/r', 'fix login', 'req-3', 'qa').objective).toMatch(/Do not edit test files/)
    expect(ownerRequestedTask('o/r', 'ship it', 'req-4', 'ship').objective).not.toMatch(/Documentation files only/)
  })

  it('owner-report is a capability (default report) and never feeds model routing', async () => {
    const { DEFAULT_CAPABILITIES } = await import('../../factory/lib/config')
    const { toAttemptRecords } = await import('../../factory/lib/ledger')
    expect(DEFAULT_CAPABILITIES['owner-report']).toBe('report')
    const entries = [{
      type: 'attempt', id: 'a', runId: 'r', at: now.toISOString(), repo: 'o/r', kind: 'owner-report', taskTier: 2, tier: 'M1', model: 'm',
      harness: 'claude-code', outcome: 'failed', reason: 'no structured report', exploring: false, durationMs: 1, costUsd: 0, inputTokens: 0, outputTokens: 0,
    }] as LedgerEntry[]
    expect(toAttemptRecords(entries)).toEqual([])
  })
})
