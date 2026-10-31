import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { SMOKE_WAIT_MS, automerge, checkState, factoryMergeDecision, smokeWait, mergesToWatch, postMergeVerdict, protectedTouched, revertSteps, watchMerged, type AutonomyDeps, type PrMergeInfo } from '../../factory/lib/automerge'
import { loadConfig } from '../../factory/lib/config'
import { readLedger, toAttemptRecords, type AttemptEntry, type LedgerEntry, type PostmergeEntry } from '../../factory/lib/ledger'
import type { ProcOptions, ProcResult } from '../../factory/lib/proc'
import type { SmokeEntry } from '../../factory/lib/smoke'
import type { emitEvent } from '../../factory/system/events'

const NOW = new Date('2026-10-13T08:00:00Z')
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString()
const PROTECTED = ['factory/', '.github/workflows/', 'src/lib/agents/model-router.ts']

const attempt = (p: Partial<AttemptEntry> = {}): AttemptEntry => ({
  type: 'attempt', id: 'a1', runId: 'r', at: minsAgo(120), repo: 'o/app', kind: 'fix-lint', taskTier: 2, tier: 'M1', model: 'free-agent',
  harness: 'claude-code', outcome: 'verified', reason: 'lint pass', exploring: false, durationMs: 1, costUsd: 0, inputTokens: 0, outputTokens: 0,
  prUrl: 'https://github.com/o/app/pull/7', ...p,
})
const run_ = (name: string, conclusion: string | null, status = 'COMPLETED') => ({ __typename: 'CheckRun', name, status, conclusion })
const ctx = (context: string, state: string) => ({ __typename: 'StatusContext', context, state })
const pr = (p: Partial<PrMergeInfo> = {}): PrMergeInfo => ({
  state: 'OPEN', mergeable: 'MERGEABLE', createdAt: minsAgo(120), reviewDecision: null, labels: [], files: [{ path: 'src/a.ts' }],
  statusCheckRollup: [run_('CI', 'SUCCESS'), ctx('Vercel', 'SUCCESS')], ...p,
})
const smoke = (verdict: SmokeEntry['verdict']): SmokeEntry => ({ type: 'smoke', attemptId: 'a1', at: minsAgo(60), repo: 'o/app', prUrl: 'https://github.com/o/app/pull/7', verdict, reasons: [] })
const decide = (p: Partial<PrMergeInfo> = {}, extra: Partial<Parameters<typeof factoryMergeDecision>[0]> = {}) =>
  factoryMergeDecision({ pr: pr(p), attempt: attempt(), smoke: smoke('pass'), protectedPaths: PROTECTED, now: NOW, ...extra })

describe('checkState', () => {
  it('reads check runs and commit statuses, from gh and from the REST API', () => {
    expect([run_('a', 'SUCCESS'), run_('b', 'NEUTRAL'), run_('c', 'SKIPPED'), run_('d', 'FAILURE'), run_('e', null, 'IN_PROGRESS')].map(checkState)).toEqual(['pass', 'pass', 'pass', 'fail', 'pending'])
    expect([ctx('a', 'SUCCESS'), ctx('b', 'PENDING'), ctx('c', 'ERROR')].map(checkState)).toEqual(['pass', 'pending', 'fail'])
    // The REST API: lowercase, no __typename (workflow runs have `status`, statuses only `state`).
    expect([{ name: 'CI', status: 'completed', conclusion: 'success' }, { name: 'CI', status: 'queued', conclusion: null }, { context: 'Vercel', state: 'failure' }].map(checkState)).toEqual(['pass', 'pending', 'fail'])
  })
  it('protected paths: a trailing slash is a folder, anything else one file', () => {
    expect(protectedTouched(['factory/run.ts', 'factory.md', 'src/lib/agents/model-router.ts', 'src/lib/agents/model-router.test.ts'], PROTECTED))
      .toEqual(['factory/run.ts', 'src/lib/agents/model-router.ts'])
  })
})

describe('factoryMergeDecision', () => {
  it('merges a PR whose checks are green and that nothing objected to', () => {
    expect(decide()).toEqual({ action: 'merge', reason: '2 checks green, preview smoke passed' })
    expect(decide({ statusCheckRollup: [] })).toEqual({ action: 'merge', reason: "no checks on this repo; the factory's judge passed it, preview smoke passed" })
    expect(decide({}, { smoke: smoke('skipped') }).action).toBe('merge')
    expect(decide({}, { attempt: attempt({ adversary: { model: 'm', verdict: 'PASS', issues: 0 } }) }).action).toBe('merge')
  })
  it('leaves it for the owner when anything objects', () => {
    expect(decide({ files: [{ path: 'src/a.ts' }, { path: '.github/workflows/ci.yml' }] })).toEqual({ action: 'leave', reason: 'it changes .github/workflows/ci.yml, which only the owner merges' })
    expect(decide({ labels: [{ name: 'needs-careful-review' }] })).toEqual({ action: 'leave', reason: 'it carries the needs-careful-review label' })
    expect(decide({ labels: [{ name: 'Hold' }] }).action).toBe('leave')
    expect(decide({ reviewDecision: 'CHANGES_REQUESTED' })).toEqual({ action: 'leave', reason: 'changes were requested in review' })
    expect(decide({}, { attempt: attempt({ adversary: { model: 'm', verdict: 'FAIL', issues: 2 } }) })).toEqual({ action: 'leave', reason: 'the adversarial reviewer argued it should not merge' })
    expect(decide({}, { smoke: smoke('fail') })).toEqual({ action: 'leave', reason: 'the preview breaks pages that work on production' })
    expect(decide({ statusCheckRollup: [run_('CI', 'FAILURE'), run_('GitGuardian', 'SUCCESS'), ctx('Vercel', 'ERROR')] })).toEqual({ action: 'leave', reason: 'CI, Vercel failed' })
    expect(decide({ mergeable: 'CONFLICTING' })).toEqual({ action: 'leave', reason: 'it conflicts with its base branch' })
  })
  it('waits while something is still running', () => {
    expect(decide({ statusCheckRollup: [run_('CI', null, 'IN_PROGRESS'), ctx('Vercel', 'SUCCESS')] })).toEqual({ action: 'wait', reason: 'checks still running' })
    expect(decide({ statusCheckRollup: [], createdAt: minsAgo(3) })).toEqual({ action: 'wait', reason: 'waiting for checks to register' })
    expect(decide({}, { smoke: null, smokePending: true })).toEqual({ action: 'wait', reason: 'waiting for the preview smoke test' })
    expect(decide({ mergeable: 'UNKNOWN' }).action).toBe('wait')
    expect(decide({ state: 'MERGED' }).action).toBe('none')
  })
  it('red checks are reported before a pending smoke test', () => {
    expect(decide({ statusCheckRollup: [run_('CI', 'FAILURE')] }, { smoke: null, smokePending: true }).action).toBe('leave')
  })
})

describe('smokeWait', () => {
  const base = { enabled: true, smoke: null, attemptAt: minsAgo(30), now: NOW, previews: true as boolean | null }
  it('waits for a smoke test that has not run on a repo that gets previews', () => {
    expect(smokeWait(base)).toBe(true)
    expect(smokeWait({ ...base, previews: null }), "Vercel couldn't be asked: wait as before").toBe(true)
  })
  it('does not wait when the repo gets no Vercel previews (project not connected to git)', () => {
    expect(smokeWait({ ...base, previews: false })).toBe(false)
  })
  it('does not wait once smoke ran, when smoke is off, or after SMOKE_WAIT_MS', () => {
    expect(smokeWait({ ...base, smoke: smoke('skipped') })).toBe(false)
    expect(smokeWait({ ...base, enabled: false })).toBe(false)
    expect(smokeWait({ ...base, attemptAt: new Date(NOW.getTime() - SMOKE_WAIT_MS).toISOString() })).toBe(false)
  })
})

describe('postMergeVerdict', () => {
  const ci = (conclusion: string | null, status = 'completed') => ({ name: 'CI', status, conclusion })
  it('blames the merge only for a check that passed on the commit before it', () => {
    expect(postMergeVerdict([ci('failure'), { context: 'Vercel', state: 'success' }], [ci('success')], minsAgo(30), NOW)).toEqual({ verdict: 'fail', failed: ['CI'], alreadyRed: [] })
    expect(postMergeVerdict([ci('failure')], [], minsAgo(30), NOW).verdict).toBe('fail') // no run before it: the merge is the change
    expect(postMergeVerdict([ci('failure')], [ci('failure')], minsAgo(30), NOW)).toEqual({ verdict: 'pass', failed: [], alreadyRed: ['CI'] })
  })
  it('ignores runs a newer push cancelled, and waits for running ones', () => {
    expect(postMergeVerdict([ci('cancelled')], [ci('success')], minsAgo(90), NOW).verdict).toBe('pass')
    expect(postMergeVerdict([ci(null, 'in_progress')], [ci('success')], minsAgo(30), NOW).verdict).toBe('pending')
  })
  it('a repo that runs nothing on its base branch: pending for an hour, then it stays', () => {
    expect(postMergeVerdict([], [], minsAgo(30), NOW).verdict).toBe('pending')
    expect(postMergeVerdict([], [], minsAgo(61), NOW).verdict).toBe('pass')
  })
})

describe('mergesToWatch', () => {
  const merged = (attemptId: string, sha: string, at = minsAgo(30)): LedgerEntry => ({ type: 'automerge', attemptId, at, action: 'merged', reason: 'green', sha, base: 'main' })
  const verdict = (p: Partial<PostmergeEntry>): PostmergeEntry => ({ type: 'postmerge', attemptId: 'a1', at: minsAgo(10), sha: 's1', passed: true, reason: 'ok', ...p })
  it('watches each factory merge until its runs have a verdict, for two days at most', () => {
    const entries: LedgerEntry[] = [merged('a1', 's1'), merged('a2', 's2'), merged('a3', 's3', minsAgo(3 * 24 * 60)), { type: 'automerge', attemptId: 'a4', at: minsAgo(5), action: 'held', reason: 'red' }, verdict({ attemptId: 'a2', sha: 's2' })]
    expect(mergesToWatch(entries, NOW).map(w => w.sha)).toEqual(['s1'])
  })
  it('then watches the revert of a red one until main has a verdict after it', () => {
    const red = verdict({ sha: 's1', passed: false, revertUrl: 'https://github.com/o/app/pull/8', revertSha: 'r1' })
    const watching = mergesToWatch([merged('a1', 's1'), red], NOW)
    expect(watching.map(w => [w.sha, w.base, !!w.revertOf])).toEqual([['r1', 'main', true]])
    expect(mergesToWatch([merged('a1', 's1'), red, verdict({ sha: 'r1', revert: true })], NOW)).toEqual([])
    expect(mergesToWatch([merged('a1', 's1'), verdict({ sha: 's1', passed: false, revertUrl: null, revertSha: null, revertError: 'push failed' })], NOW)).toEqual([])
  })
})

describe('revertSteps', () => {
  it('clones the base, reverts the merge commit on a branch, and merges a PR that says why', () => {
    const steps = revertSteps({ repo: 'o/app', url: 'https://github.com/o/app.git', prUrl: 'https://github.com/o/app/pull/7', base: 'main', sha: 'abcdef1234567890', parents: 1, reason: 'CI failed on main', work: '/w' })
    expect(steps.map(([cmd, args]) => [cmd, ...args.filter(a => a !== '-c' && !a.startsWith('credential.helper'))].slice(0, 4).join(' '))).toEqual([
      'git clone -q --filter=blob:none', 'git checkout -q -b', 'git revert --no-edit abcdef1234567890', 'git push -q -u', 'gh pr create --repo', 'gh pr merge factory/revert-7',
    ])
    expect(steps[0]![1]).toContain('credential.helper=!gh auth git-credential')
    expect(steps[4]![1].join(' ')).toMatch(/--title Revert o\/app\/pull\/7 --body Reverted by the RepoHQ factory: CI failed on main/)
    expect(steps.slice(1).every(s => s[2] === '/w')).toBe(true)
  })
  it('reverts a true merge commit against its first parent', () => {
    const steps = revertSteps({ repo: 'o/app', url: 'u', prUrl: 'https://github.com/o/app/pull/7', base: 'main', sha: 'abc', parents: 2, reason: 'r', work: '/w' })
    expect(steps[2]![1].slice(-3)).toEqual(['-m', '1', 'abc'])
  })
})

describe('what the router learns', () => {
  it('a merge the factory had to revert counts as a failure; its revert verdict changes nothing', () => {
    const merged = (id: string): LedgerEntry => ({ type: 'resolution', attemptId: id, at: minsAgo(60), outcome: 'merged' })
    const entries: LedgerEntry[] = [
      attempt({ id: 'ok' }), merged('ok'),
      attempt({ id: 'bad' }), merged('bad'),
      { type: 'postmerge', attemptId: 'bad', at: minsAgo(30), sha: 's', passed: false, reason: 'CI failed', revertUrl: 'u', revertSha: 'r' },
      { type: 'postmerge', attemptId: 'ok', at: minsAgo(30), sha: 's2', passed: true, reason: 'green' },
      { type: 'postmerge', attemptId: 'ok', at: minsAgo(20), sha: 'r2', passed: false, revert: true, reason: 'still red' },
    ]
    expect(toAttemptRecords(entries).map(r => r.outcome)).toEqual(['success', 'failed'])
  })
})

describe('config', () => {
  it('merging is off unless the config turns it on; reverts and the protected paths default on', () => {
    const cfg = loadConfig({ FACTORY_CONFIG: '/nonexistent/factory.config.json' } as unknown as NodeJS.ProcessEnv)
    expect(cfg.autonomy).toEqual({ merge: false, revert: true, protectedPaths: PROTECTED })
    expect(loadConfig({} as NodeJS.ProcessEnv).autonomy.merge).toBe(true) // factory/factory.config.json: the owner's call
  })
})

describe('automerge and watchMerged against a fake GitHub', () => {
  const PR = 'https://github.com/o/app/pull/7'
  const MERGE = 'a'.repeat(40), PARENT = 'b'.repeat(40), REVERT = 'c'.repeat(40)
  let home: string
  let calls: string[]
  let events: Parameters<typeof emitEvent>[0][]
  let gh: { pr: PrMergeInfo & { isDraft?: boolean; baseRefName?: string }; mergeFails?: boolean; runs: Record<string, unknown[]>; statuses: Record<string, unknown[]> }
  const cfg = () => ({ home, smoke: { enabled: true, paths: {}, maxPerCycle: 3 }, autonomy: { merge: true, revert: true, protectedPaths: PROTECTED } })
  const write = (entries: LedgerEntry[]) => writeFileSync(path.join(home, 'ledger.jsonl'), entries.map(e => JSON.stringify(e)).join('\n') + '\n')
  const ok = (output = ''): ProcResult => ({ code: 0, output, durationMs: 1, timedOut: false })
  const run = async (cmd: string, args: string[], _opts?: ProcOptions): Promise<ProcResult> => {
    const a = args.filter(x => x !== '-c' && !x.startsWith('credential.helper'))
    calls.push([cmd, ...a].slice(0, 3).join(' '))
    if (cmd === 'git') return ok()
    if (a[0] === 'pr' && a[1] === 'view') {
      const fields = a[a.indexOf('--json') + 1]
      if (fields === 'mergeCommit') return ok(a[2] === PR ? MERGE : REVERT)
      if (fields === 'commits') return ok('1')
      return ok(JSON.stringify(gh.pr))
    }
    if (a[0] === 'pr' && a[1] === 'merge') return gh.mergeFails && a[2] === PR ? { ...ok('GraphQL: Pull request is not mergeable'), code: 1 } : ok()
    if (a[0] === 'pr' && a[1] === 'create') return ok('https://github.com/o/app/pull/8\n')
    if (a[0] === 'api') {
      const sha = /[0-9a-f]{40}/.exec(a[1]!)?.[0] ?? ''
      if (a[1]!.includes('/actions/runs')) return ok(JSON.stringify(gh.runs[sha] ?? []))
      if (a[1]!.endsWith('/status')) return ok(JSON.stringify(gh.statuses[sha] ?? []))
      return ok(sha === MERGE ? PARENT : MERGE)
    }
    return ok()
  }
  const deps = (): AutonomyDeps => ({ run, workDir: path.join(home, 'work'), now: () => NOW, emit: e => { events.push(e) } })
  const merged = (at = minsAgo(90)): LedgerEntry => ({ type: 'automerge', attemptId: 'a1', at, action: 'merged', reason: 'green', sha: MERGE, base: 'main' })
  const ci = (conclusion: string) => ({ name: 'CI', status: 'completed', conclusion })

  beforeEach(() => {
    home = mkdtempSync(path.join(tmpdir(), 'automerge-'))
    calls = []
    events = []
    gh = { pr: { ...pr(), isDraft: true, baseRefName: 'main' }, runs: {}, statuses: {} }
  })

  it('merges a green draft PR: ready, squash merge, recorded as merged by the factory', async () => {
    write([attempt(), smoke('pass')])
    await automerge(cfg(), deps())
    expect(calls).toEqual(['gh pr view', 'gh pr ready', 'gh pr merge', 'gh pr view', 'gh pr view'])
    const entries = readLedger(home)
    expect(entries.find(e => e.type === 'automerge')).toMatchObject({ action: 'merged', sha: MERGE, base: 'main', reason: '2 checks green, preview smoke passed' })
    expect(entries.find(e => e.type === 'resolution')).toMatchObject({ outcome: 'merged', humanCommits: 0 })
    expect(events.map(e => [e.event, e.status])).toEqual([['merge', 'ok']])
  })
  it('merges a young unsmoked PR on green checks when the repo gets no Vercel previews, and waits when it does', async () => {
    write([attempt({ at: minsAgo(20) })])
    const asked: string[] = []
    await automerge(cfg(), { ...deps(), getsPreviews: async repo => { asked.push(repo); return true } })
    expect(calls, 'previews exist: waits for the smoke test').toEqual(['gh pr view'])
    await automerge(cfg(), { ...deps(), getsPreviews: async repo => { asked.push(repo); return false } })
    expect(asked).toEqual(['o/app', 'o/app'])
    expect(readLedger(home).find(e => e.type === 'automerge')).toMatchObject({ action: 'merged', reason: '2 checks green' })
  })
  it('asks Vercel through the injected runner and keeps waiting when it cannot tell', async () => {
    write([attempt({ at: minsAgo(20) })])
    await automerge(cfg(), deps()) // the fake answers `vercel api` with nothing: unknown
    expect(calls).toEqual(['gh pr view', 'vercel api /v9/projects?repoUrl=https://github.com/o/app'])
    expect(readLedger(home).filter(e => e.type === 'automerge')).toEqual([])
  })
  it('leaves a red PR, saying why once, and alerts when GitHub refuses a merge', async () => {
    write([attempt(), smoke('pass')])
    gh.pr = { ...gh.pr, statusCheckRollup: [run_('CI', 'FAILURE')] }
    await automerge(cfg(), deps())
    await automerge(cfg(), deps())
    expect(calls.filter(c => c !== 'gh pr view'), 'never merged').toEqual([])
    expect(readLedger(home).filter(e => e.type === 'automerge')).toMatchObject([{ action: 'held', reason: 'CI failed' }])
    expect(events.map(e => [e.event, e.status])).toEqual([['hold', 'info']])
    gh.pr = { ...gh.pr, statusCheckRollup: [run_('CI', 'SUCCESS')] }
    gh.mergeFails = true
    await automerge(cfg(), deps())
    expect(events.at(-1)).toMatchObject({ event: 'merge', status: 'fail', message: `couldn't merge ${PR}: GraphQL: Pull request is not mergeable` })
    expect(readLedger(home).some(e => e.type === 'resolution'), 'still open').toBe(false)
  })
  it('waits for the smoke test, then merges without one after six hours', async () => {
    const previews = { ...deps(), getsPreviews: async () => true }
    write([attempt({ at: minsAgo(60) })])
    await automerge(cfg(), previews)
    expect(calls).toEqual(['gh pr view'])
    write([attempt({ at: minsAgo(7 * 60) })])
    await automerge(cfg(), previews)
    expect(calls).toContain('gh pr merge')
  })
  it('reverts a merge that turned main red, then closes the alert once main is green again', async () => {
    write([attempt(), merged()])
    gh.runs = { [MERGE]: [ci('failure')], [PARENT]: [ci('success')] }
    await watchMerged(cfg(), deps())
    expect(calls.filter(c => c.startsWith('git') || c.startsWith('gh pr'))).toEqual(['git clone -q', 'git checkout -q', 'git revert --no-edit', 'git push -q', 'gh pr create', 'gh pr merge', 'gh pr view'])
    expect(readLedger(home).find(e => e.type === 'postmerge')).toMatchObject({ sha: MERGE, passed: false, revertUrl: 'https://github.com/o/app/pull/8', revertSha: REVERT })
    expect(events).toMatchObject([{ event: 'revert', status: 'fail', message: 'reverted app#7: CI failed on main after it merged, and passed before it — https://github.com/o/app/pull/8' }])
    // The revert's own commit: still running, then green.
    gh.runs[REVERT] = [{ name: 'CI', status: 'in_progress', conclusion: null }]
    await watchMerged(cfg(), deps())
    expect(events).toHaveLength(1)
    gh.runs[REVERT] = [ci('success')]
    await watchMerged(cfg(), deps())
    expect(events.at(-1)).toMatchObject({ event: 'revert', status: 'ok', message: 'app#7: main is green again after the revert' })
    await watchMerged(cfg(), deps())
    expect(events, 'judged once').toHaveLength(2)
  })
  it('a base branch still red after the revert needs the owner (judged on its own, not against its red parent)', async () => {
    write([attempt(), merged(), { type: 'postmerge', attemptId: 'a1', at: minsAgo(30), sha: MERGE, passed: false, reason: 'CI failed', revertUrl: 'https://github.com/o/app/pull/8', revertSha: REVERT }])
    gh.runs = { [REVERT]: [ci('failure')], [MERGE]: [ci('failure')] }
    await watchMerged(cfg(), deps())
    expect(readLedger(home).at(-1)).toMatchObject({ type: 'postmerge', sha: REVERT, revert: true, passed: false, reason: 'CI still fails on main after the revert' })
    expect(events).toMatchObject([{ event: 'revert', status: 'fail', message: 'app#7: CI still fails on main after the revert; needs the owner' }])
    expect(calls.some(c => c.startsWith('git')), 'never a revert of a revert').toBe(false)
  })
  it("doesn't revert when the check was already red before the merge; a failed revert needs the owner", async () => {
    write([attempt(), merged()])
    gh.runs = { [MERGE]: [ci('failure')], [PARENT]: [ci('failure')] }
    await watchMerged(cfg(), deps())
    expect(calls.some(c => c.startsWith('git')), 'no revert').toBe(false)
    expect(readLedger(home).find(e => e.type === 'postmerge')).toMatchObject({ passed: true, reason: 'green apart from CI, which already failed before it' })
    expect(events).toEqual([])

    write([attempt(), merged()])
    gh.runs = { [MERGE]: [ci('failure')], [PARENT]: [ci('success')] }
    const failing = async (cmd: string, args: string[], opts?: ProcOptions) => (cmd === 'git' && args.includes('push') ? { ...ok('remote: Permission denied'), code: 1 } : run(cmd, args, opts))
    await watchMerged(cfg(), { ...deps(), run: failing })
    expect(readLedger(home).find(e => e.type === 'postmerge')).toMatchObject({ passed: false, revertUrl: null, revertSha: null, revertError: 'git push -q failed: remote: Permission denied' })
    expect(events.at(-1)).toMatchObject({ event: 'revert', status: 'fail' })
    expect(mergesToWatch(readLedger(home), NOW), 'nothing more to watch').toEqual([])
  })
})
