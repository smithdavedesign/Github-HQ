/**
 * The factory merges its own PRs and reverts what breaks the base branch (the owner's call,
 * 2026-10-12: agents merge everything; he reviews what was done in the morning email). The idea
 * pipeline does the same for its PRs (idea-factory lib/autonomy.js).
 *
 * A factory PR merges when every GitHub check is green (CI, GitGuardian, the Vercel preview, and on
 * RepoHQ the Autonomous PR Policy check), the preview smoke test and the adversarial reviewer didn't
 * object, nobody asked for changes or put a hold label on it, it doesn't conflict, and it touches no
 * protected path. Anything else stays open for the owner. After a merge, the merge commit's own
 * runs on the base branch decide: green stays, red is reverted by a revert PR the factory merges.
 *
 * Pure decisions first; then `automerge` and `watchMerged`, which run.ts's reconcile step calls
 * with the gh/git runner injected (tests pass a fake GitHub).
 */
import { mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import type { FactoryConfig } from './config'
import { GIT_CRED, humanCommitsOn } from './git'
import { appendEntry, openPrAttempts, readLedger, type AttemptEntry, type AutomergeEntry, type LedgerEntry, type PostmergeEntry, type SmokeEntry } from './ledger'
import { run as defaultRun, type Runner } from './proc'
import { emitEvent } from '../system/events'

/** One entry of gh's statusCheckRollup, a workflow run, or a commit status. */
export interface CheckLike { __typename?: string; name?: string; context?: string; workflowName?: string; status?: string | null; conclusion?: string | null; state?: string }

export interface PrMergeInfo {
  state: string
  mergeable?: string
  createdAt?: string
  reviewDecision?: string | null
  labels?: { name: string }[]
  files?: { path: string }[]
  statusCheckRollup?: CheckLike[]
}

export type MergeAction = 'merge' | 'wait' | 'leave' | 'none'

/**
 * Labels that keep a PR for the owner: the adversarial reviewer's (FAIL or UNCERTAIN), a failed
 * preview smoke test, and the owner's own hold.
 */
export const HOLD_LABELS = ['needs-careful-review', 'smoke:fail', 'hold', 'do-not-merge']

const MINUTE = 60_000

export function checkState(c: CheckLike): 'pass' | 'pending' | 'fail' {
  if (c.__typename === 'StatusContext' || (c.state !== undefined && c.status === undefined)) {
    const s = String(c.state ?? '').toUpperCase()
    return s === 'SUCCESS' ? 'pass' : s === 'PENDING' || s === 'EXPECTED' ? 'pending' : 'fail'
  }
  if (String(c.status ?? '').toUpperCase() !== 'COMPLETED') return 'pending'
  return ['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(String(c.conclusion ?? '').toUpperCase()) ? 'pass' : 'fail'
}

const checkName = (c: CheckLike) => c.name ?? c.context ?? c.workflowName ?? 'a check'

/** The protected paths a PR touches: an entry ending in "/" is a folder, anything else one file. */
export function protectedTouched(files: string[], protectedPaths: string[]): string[] {
  return files.filter(f => protectedPaths.some(p => (p.endsWith('/') ? f.startsWith(p) : f === p)))
}

/**
 * What to do with one open factory PR (pure). `smokePending`: the PR's preview smoke test hasn't run
 * yet and is still worth waiting for (the caller decides how long).
 */
export function factoryMergeDecision(input: {
  pr: PrMergeInfo; attempt: AttemptEntry; smoke?: SmokeEntry | null; smokePending?: boolean; protectedPaths: string[]; now: Date; settleMinutes?: number
}): { action: MergeAction; reason: string } {
  const { pr, attempt, smoke, smokePending, protectedPaths, now, settleMinutes = 10 } = input
  if (pr.state !== 'OPEN') return { action: 'none', reason: 'not open' }
  const touched = protectedTouched((pr.files ?? []).map(f => f.path), protectedPaths)
  if (touched.length) return { action: 'leave', reason: `it changes ${touched.slice(0, 3).join(', ')}, which only the owner merges` }
  const hold = (pr.labels ?? []).map(l => l.name).find(l => HOLD_LABELS.includes(l.toLowerCase()))
  if (hold) return { action: 'leave', reason: `it carries the ${hold} label` }
  if (pr.reviewDecision === 'CHANGES_REQUESTED') return { action: 'leave', reason: 'changes were requested in review' }
  if (attempt.adversary?.verdict === 'FAIL') return { action: 'leave', reason: 'the adversarial reviewer argued it should not merge' }
  if (smoke?.verdict === 'fail') return { action: 'leave', reason: 'the preview breaks pages that work on production' }
  const checks = pr.statusCheckRollup ?? []
  const failed = checks.filter(c => checkState(c) === 'fail')
  if (failed.length) return { action: 'leave', reason: `${failed.map(checkName).slice(0, 3).join(', ')} failed` }
  if (checks.some(c => checkState(c) === 'pending')) return { action: 'wait', reason: 'checks still running' }
  if (!checks.length && now.getTime() - new Date(pr.createdAt ?? 0).getTime() < settleMinutes * MINUTE) return { action: 'wait', reason: 'waiting for checks to register' }
  if (smokePending) return { action: 'wait', reason: 'waiting for the preview smoke test' }
  if (pr.mergeable === 'CONFLICTING') return { action: 'leave', reason: 'it conflicts with its base branch' }
  if (pr.mergeable === 'UNKNOWN') return { action: 'wait', reason: 'GitHub is still computing mergeability' }
  const smoked = smoke?.verdict === 'pass' ? ', preview smoke passed' : ''
  return { action: 'merge', reason: checks.length ? `${checks.length} check${checks.length === 1 ? '' : 's'} green${smoked}` : `no checks on this repo; the factory's judge passed it${smoked}` }
}

/** Cancelled or superseded runs on the base branch say nothing about the merge (a newer push cancels them). */
const SUPERSEDED = ['CANCELLED', 'STALE']

/**
 * After a merge (pure): the merge commit's own runs on the base branch (push-triggered workflow runs
 * and commit statuses such as the Vercel production deploy; scheduled runs are the caller's to leave
 * out), against the same runs on the commit before it. A check that fails on the merge commit but
 * passed on its parent, or has no run there, blames the merge: revert. Failing on both → main was
 * already red: not this merge's doing. No runs at all an hour later → the repo runs nothing on its
 * base branch: it stays.
 */
export function postMergeVerdict(checks: CheckLike[], parentChecks: CheckLike[], mergedAt: string, now: Date): { verdict: 'pass' | 'fail' | 'pending'; failed: string[]; alreadyRed: string[] } {
  const counted = checks.filter(c => !SUPERSEDED.includes(String(c.conclusion ?? '').toUpperCase()))
  if (counted.some(c => checkState(c) === 'pending')) return { verdict: 'pending', failed: [], alreadyRed: [] }
  const red = counted.filter(c => checkState(c) === 'fail').map(checkName)
  const redBefore = new Set(parentChecks.filter(c => checkState(c) === 'fail').map(checkName))
  const failed = [...new Set(red.filter(n => !redBefore.has(n)))]
  const alreadyRed = [...new Set(red.filter(n => redBefore.has(n)))]
  if (failed.length) return { verdict: 'fail', failed, alreadyRed }
  if (!counted.length && now.getTime() - new Date(mergedAt).getTime() <= 60 * MINUTE) return { verdict: 'pending', failed: [], alreadyRed: [] }
  return { verdict: 'pass', failed: [], alreadyRed }
}

/** A merge commit waiting for its verdict on the base branch: a factory merge, or the revert of one. */
export interface WatchedMerge { attemptId: string; sha: string; at: string; base: string; revertOf?: PostmergeEntry }

/**
 * The factory's merge commits of the last two days with no verdict yet (pure), and the commits of the
 * reverts it made, watched until main is green again. Keyed by sha: a commit is judged once.
 */
export function mergesToWatch(entries: LedgerEntry[], now: Date, windowMs = 2 * 24 * 60 * MINUTE): WatchedMerge[] {
  const judged = new Set(entries.filter((e): e is PostmergeEntry => e.type === 'postmerge').map(e => e.sha))
  const recent = (at: string) => now.getTime() - new Date(at).getTime() <= windowMs
  const merged = entries.filter((e): e is AutomergeEntry => e.type === 'automerge' && e.action === 'merged' && !!e.sha)
  const merges = merged.filter(m => !judged.has(m.sha!) && recent(m.at))
  const base = new Map(merged.map(m => [m.attemptId, m.base ?? 'main']))
  const reverts = entries.filter((e): e is PostmergeEntry => e.type === 'postmerge' && !e.passed && !e.revert && !!e.revertSha && !judged.has(e.revertSha) && recent(e.at))
  return [
    ...merges.map(m => ({ attemptId: m.attemptId, sha: m.sha!, at: m.at, base: m.base ?? 'main' })),
    ...reverts.map(r => ({ attemptId: r.attemptId, sha: r.revertSha!, at: r.at, base: base.get(r.attemptId) ?? 'main', revertOf: r })),
  ]
}

/**
 * The commands that undo a merged PR (pure): a clone of the base branch from `url`, branch
 * factory/revert-<n>, `git revert` of the merge commit (`-m 1` for a true merge commit), push, a PR
 * that says why, merged. [cmd, args, cwd?] each. Host git and gh run as the factory's GitHub App.
 */
export function revertSteps(input: { repo: string; url: string; prUrl: string; base: string; sha: string; parents: number; reason: string; work: string }): [string, string[], string?][] {
  const { repo, url, prUrl, base, sha, parents, reason, work } = input
  const n = prUrl.split('/').pop() ?? 'pr'
  const branch = `factory/revert-${n}`
  const body = `Reverted by the RepoHQ factory: ${reason}\n\nThis undoes ${prUrl} (\`${sha.slice(0, 7)}\`), which the factory merged itself. The owner's rule (2026-10-12): agents merge their own PRs and revert what breaks; he reviews it in the morning email.`
  return [
    ['git', [...GIT_CRED, 'clone', '-q', '--filter=blob:none', '--no-tags', '--branch', base, url, work]],
    ['git', ['checkout', '-q', '-b', branch], work],
    ['git', [...GIT_CRED, 'revert', '--no-edit', ...(parents > 1 ? ['-m', '1'] : []), sha], work],
    ['git', [...GIT_CRED, 'push', '-q', '-u', 'origin', branch], work],
    ['gh', ['pr', 'create', '--repo', repo, '--base', base, '--head', branch, '--title', `Revert ${prUrl.replace('https://github.com/', '')}`, '--body', body], work],
    ['gh', ['pr', 'merge', branch, '--repo', repo, '--squash', '--delete-branch'], work],
  ]
}

// ─── The gh and git side (run.ts reconcile) ─────────────────────────────────

export interface AutonomyDeps {
  /** Host gh/git (proc.ts run: the factory's GitHub App when configured). */
  run?: Runner
  log?: (message: string) => void
  /** The run's trace on the Agents page. */
  trace?: (status: 'ok' | 'fail' | 'info', detail: string, data?: Record<string, unknown>) => void
  /** Mirror a resolution to RepoHQ (sink.ts). */
  recordResolution?: (attemptId: string, outcome: 'merged', humanCommits: number | null) => Promise<void>
  /** The system log (factory/system/events.ts). */
  emit?: typeof emitEvent
  /** Where revert clones go (this run's work folder). */
  workDir: string
  now?: () => Date
}

type AutonomyConfig = Pick<FactoryConfig, 'home' | 'smoke' | 'autonomy'>

/** How long a PR waits for its preview smoke test (a few run per cycle) before it merges without one. */
export const SMOKE_WAIT_MS = 6 * 60 * MINUTE

const SHA = /^[0-9a-f]{40}$/
const lastLine = (out: string) => out.trim().split('\n').pop()?.slice(0, 200) ?? ''

/**
 * Merge each open factory PR that passes the gate (factoryMergeDecision), marking it ready first:
 * factory PRs open as drafts. A PR the gate leaves is recorded once per reason, for the morning
 * report, and looked at again every cycle (a re-run check or a pushed fix can turn it green).
 */
export async function automerge(cfg: AutonomyConfig, deps: AutonomyDeps): Promise<void> {
  const run = deps.run ?? defaultRun
  const emit = deps.emit ?? emitEvent
  const now = deps.now ?? (() => new Date())
  const ledger = readLedger(cfg.home)
  const smokes = new Map(ledger.filter((e): e is SmokeEntry => e.type === 'smoke').map(e => [e.attemptId, e]))
  const lastHold = new Map(ledger.filter((e): e is AutomergeEntry => e.type === 'automerge' && e.action === 'held').map(e => [e.attemptId, e.reason]))
  // From the factory's home, not a checkout: --delete-branch must never touch a local clone's branches.
  const gh = (args: string[]) => run('gh', args, { cwd: cfg.home, timeoutMs: 120_000 })
  for (const a of openPrAttempts(ledger)) {
    const view = await gh(['pr', 'view', a.prUrl!, '--json', 'state,isDraft,mergeable,createdAt,baseRefName,reviewDecision,labels,files,statusCheckRollup'])
    let pr: PrMergeInfo & { isDraft?: boolean; baseRefName?: string }
    try { pr = JSON.parse(view.output) } catch { continue }
    const at = now()
    const smoke = smokes.get(a.id) ?? null
    const smokePending = cfg.smoke.enabled && !smoke && at.getTime() - new Date(a.at).getTime() < SMOKE_WAIT_MS
    const d = factoryMergeDecision({ pr, attempt: a, smoke, smokePending, protectedPaths: cfg.autonomy.protectedPaths, now: at })
    const subject = { repo: a.repo, pr: a.prUrl }
    if (d.action === 'leave' && lastHold.get(a.id) !== d.reason) {
      appendEntry(cfg.home, { type: 'automerge', attemptId: a.id, at: at.toISOString(), action: 'held', reason: d.reason })
      deps.log?.(`autonomy: left ${a.prUrl} for the owner — ${d.reason}`)
      emit({ system: 'factory', component: 'autonomy', event: 'hold', status: 'info', message: `left ${a.prUrl} for the owner: ${d.reason}`, subject })
    }
    if (d.action !== 'merge') continue
    if (pr.isDraft) await gh(['pr', 'ready', a.prUrl!])
    let merged = await gh(['pr', 'merge', a.prUrl!, '--squash', '--delete-branch'])
    if (merged.code !== 0) merged = await gh(['pr', 'merge', a.prUrl!, '--merge', '--delete-branch'])
    if (merged.code !== 0) {
      const why = lastLine(merged.output) || 'gh pr merge failed'
      deps.log?.(`autonomy: couldn't merge ${a.prUrl} — ${why}`)
      emit({ system: 'factory', component: 'autonomy', event: 'merge', status: 'fail', message: `couldn't merge ${a.prUrl}: ${why}`, subject })
      continue
    }
    const oid = (await gh(['pr', 'view', a.prUrl!, '--json', 'mergeCommit', '--jq', '.mergeCommit.oid'])).output.trim()
    const done = now().toISOString()
    appendEntry(cfg.home, { type: 'automerge', attemptId: a.id, at: done, action: 'merged', reason: d.reason, sha: SHA.test(oid) ? oid : null, base: pr.baseRefName || 'main' })
    const humanCommits = await humanCommitsOn(a.prUrl!, run)
    appendEntry(cfg.home, { type: 'resolution', attemptId: a.id, at: done, outcome: 'merged', ...(humanCommits !== null ? { humanCommits } : {}) })
    await deps.recordResolution?.(a.id, 'merged', humanCommits)
    deps.log?.(`autonomy: merged ${a.prUrl} (${d.reason})`)
    deps.trace?.('ok', `merged ${a.prUrl}: ${d.reason}`, { repo: a.repo })
    emit({ system: 'factory', component: 'autonomy', event: 'merge', status: 'ok', message: `merged ${a.prUrl}: ${d.reason}`, subject })
  }
}

/**
 * A commit's own runs: push-triggered workflow runs and commit statuses (the Vercel deploy). Scheduled
 * runs are left out: they run on whatever commit is newest, so a failing cron job would blame a merge.
 * null when GitHub can't be asked (looked at again next cycle).
 */
async function commitChecks(run: Runner, repo: string, sha: string): Promise<CheckLike[] | null> {
  const runs = await run('gh', ['api', `repos/${repo}/actions/runs?head_sha=${sha}&event=push&per_page=50`, '--jq', '[.workflow_runs[] | {name, status, conclusion}]'], { timeoutMs: 60_000 })
  const statuses = await run('gh', ['api', `repos/${repo}/commits/${sha}/status`, '--jq', '[.statuses[] | {context, state}]'], { timeoutMs: 60_000 })
  if (runs.code !== 0 || statuses.code !== 0) return null
  try { return [...JSON.parse(runs.output), ...JSON.parse(statuses.output)] as CheckLike[] } catch { return null }
}

/**
 * After an automerge: the merge commit's own runs on the base branch decide (postMergeVerdict). Red
 * where its parent was green → reverted by a revert PR the factory merges, and Slack is told (status
 * fail); the revert's commit is then watched, and the base branch green again closes the alert
 * (status ok). Never a revert of a revert: still red after one is left for the owner.
 */
export async function watchMerged(cfg: AutonomyConfig, deps: AutonomyDeps): Promise<void> {
  const run = deps.run ?? defaultRun
  const emit = deps.emit ?? emitEvent
  const now = deps.now ?? (() => new Date())
  const ledger = readLedger(cfg.home)
  const attempts = new Map(ledger.filter((e): e is AttemptEntry => e.type === 'attempt').map(a => [a.id, a]))
  for (const w of mergesToWatch(ledger, now())) {
    const a = attempts.get(w.attemptId)
    if (!a?.prUrl) continue
    const parents = (await run('gh', ['api', `repos/${a.repo}/commits/${w.sha}`, '--jq', '[.parents[].sha] | join(" ")'], { timeoutMs: 60_000 })).output.trim().split(/\s+/).filter(x => SHA.test(x))
    const mine = await commitChecks(run, a.repo, w.sha)
    // A revert is judged on its own: green again means nothing failing, whatever its (red) parent did.
    const before = w.revertOf || !parents[0] ? [] : await commitChecks(run, a.repo, parents[0])
    if (!mine || !before) continue
    const v = postMergeVerdict(mine, before, w.at, now())
    if (v.verdict === 'pending') continue
    const subject = { repo: a.repo, pr: a.prUrl }
    const name = `${a.repo.split('/')[1]}#${a.prUrl.split('/').pop()}`
    if (w.revertOf) {
      const green = v.verdict === 'pass'
      const reason = green ? `${w.base} is green again after the revert` : `${v.failed.join(', ')} still fail${v.failed.length === 1 ? 's' : ''} on ${w.base} after the revert`
      appendEntry(cfg.home, { type: 'postmerge', attemptId: a.id, at: now().toISOString(), sha: w.sha, passed: green, revert: true, reason })
      deps.log?.(`autonomy: ${name} — ${reason}`)
      emit({ system: 'factory', component: 'autonomy', event: 'revert', status: green ? 'ok' : 'fail', message: green ? `${name}: ${reason}` : `${name}: ${reason}; needs the owner`, subject })
      continue
    }
    if (v.verdict === 'pass') {
      const reason = v.alreadyRed.length ? `green apart from ${v.alreadyRed.join(', ')}, which already failed before it` : `its runs on ${w.base} passed`
      appendEntry(cfg.home, { type: 'postmerge', attemptId: a.id, at: now().toISOString(), sha: w.sha, passed: true, reason })
      continue
    }
    const reason = `${v.failed.join(', ')} failed on ${w.base} after it merged, and passed before it`
    const rv = cfg.autonomy.revert ? await revertMerge(run, a, w, parents.length, reason, deps.workDir) : { url: null, sha: null, error: 'reverts are off (autonomy.revert)' }
    appendEntry(cfg.home, { type: 'postmerge', attemptId: a.id, at: now().toISOString(), sha: w.sha, passed: false, reason, revertUrl: rv.url, revertSha: rv.sha, ...(rv.error ? { revertError: rv.error } : {}) })
    const message = rv.error ? `${name} broke ${w.base} (${reason}) and couldn't be reverted: ${rv.error}` : `reverted ${name}: ${reason} — ${rv.url}`
    deps.log?.(`autonomy: ${message}`)
    deps.trace?.(rv.error ? 'fail' : 'info', message, { repo: a.repo })
    emit({ system: 'factory', component: 'autonomy', event: 'revert', status: 'fail', message, subject })
  }
}

/** Undo a factory merge: a revert PR, merged (revertSteps). Its merge commit is watched next. */
async function revertMerge(run: Runner, a: AttemptEntry, w: WatchedMerge, parents: number, reason: string, workDir: string): Promise<{ url: string | null; sha: string | null; error?: string }> {
  const work = path.join(workDir, `revert-${a.repo.replace(/[^\w.-]+/g, '_')}-${a.prUrl!.split('/').pop()}`)
  const url = (process.env.FACTORY_GIT_URL ?? 'https://github.com/{repo}.git').replace('{repo}', a.repo)
  rmSync(work, { recursive: true, force: true })
  mkdirSync(workDir, { recursive: true })
  let prUrl: string | null = null
  try {
    for (const [cmd, args, cwd] of revertSteps({ repo: a.repo, url, prUrl: a.prUrl!, base: w.base, sha: w.sha, parents, reason, work })) {
      const r = await run(cmd, args, { cwd: cwd ?? workDir, timeoutMs: 180_000 })
      prUrl ??= r.output.match(/https:\/\/github\.com\/\S+\/pull\/\d+/)?.[0] ?? null
      if (r.code !== 0) return { url: prUrl, sha: null, error: `${cmd} ${args.filter(x => x !== '-c' && !x.startsWith('credential.helper')).slice(0, 2).join(' ')} failed: ${lastLine(r.output)}` }
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
  const oid = prUrl ? (await run('gh', ['pr', 'view', prUrl, '--json', 'mergeCommit', '--jq', '.mergeCommit.oid'], { timeoutMs: 60_000 })).output.trim() : ''
  return { url: prUrl, sha: SHA.test(oid) ? oid : null }
}
