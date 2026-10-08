import { appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { parseDiff, type DiffInfo } from './verify'
import { run, type Runner } from './proc'
import { PR_VALUE_LABELS } from '../../src/lib/agents/pr-value'

// Use gh as the credential helper per command — no global git config changes.
const CRED = ['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential']

/**
 * Working-tree operations take an optional `runner` so they can run inside the sandbox
 * (on its copy of the repo); clone / fetch / push / PR always run on the host.
 */
async function git(dir: string, args: string[], timeoutMs = 120_000, runner: Runner = run) {
  return runner('git', ['-C', dir, ...args], { timeoutMs })
}

async function must(label: string, p: ReturnType<typeof run>) {
  const r = await p
  if (r.code !== 0) throw new Error(`${label} failed: ${r.output.trim().split('\n').slice(-3).join(' | ')}`)
  return r
}

export async function cloneRepo(fullName: string, dir: string): Promise<void> {
  mkdirSync(path.dirname(dir), { recursive: true })
  // FACTORY_GIT_URL (e.g. file:///tmp/fixtures/{repo}.git) lets the e2e check run against local repos.
  const url = (process.env.FACTORY_GIT_URL ?? 'https://github.com/{repo}.git').replace('{repo}', fullName)
  await must(`clone ${fullName}`, run('git', [...CRED, 'clone', '--depth', '30', '--no-tags', url, dir], { timeoutMs: 300_000 }))
  // Keep tool droppings out of diffs (untracked only — tracked files are unaffected).
  appendFileSync(path.join(dir, '.git/info/exclude'), '\nnode_modules/\n.next/\n*.tsbuildinfo\ncoverage/\n.aider*\n.claude/\n')
}

/**
 * If the remote has `branch` (e.g. integration/agent), fetch and check it out so scans,
 * fixes and the PR base all use it. Shallow clones only fetch the default branch.
 */
export async function checkoutIntegrationBranch(dir: string, branch: string): Promise<boolean> {
  const ls = await run('git', ['-C', dir, ...CRED, 'ls-remote', '--heads', 'origin', branch], { timeoutMs: 60_000 })
  if (ls.code !== 0 || !ls.output.includes(`refs/heads/${branch}`)) return false
  await must(`fetch ${branch}`, run('git', ['-C', dir, ...CRED, 'fetch', '-q', '--depth', '30', 'origin', `${branch}:${branch}`], { timeoutMs: 300_000 }))
  await must(`checkout ${branch}`, git(dir, ['checkout', '-q', branch]))
  return true
}

export async function currentBranch(dir: string): Promise<string> {
  return (await must('rev-parse', git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']))).output.trim()
}

export async function checkoutNewBranch(dir: string, base: string, branch: string, runner: Runner = run): Promise<void> {
  await resetWorktree(dir, runner)
  await must('checkout base', git(dir, ['checkout', '-q', base], undefined, runner))
  await must('checkout -B', git(dir, ['checkout', '-q', '-B', branch], undefined, runner))
}

/** Discard all tracked changes and untracked files (ignored files such as node_modules survive). */
export async function resetWorktree(dir: string, runner: Runner = run): Promise<void> {
  await git(dir, ['reset', '-q', '--hard'], undefined, runner)
  await git(dir, ['clean', '-q', '-fd'], undefined, runner)
}

export async function diffInfo(dir: string, runner: Runner = run): Promise<DiffInfo> {
  const g = (args: string[]) => git(dir, args, undefined, runner)
  await g(['add', '-A'])
  const numstat = (await g(['diff', '--cached', '--numstat'])).output
  const patch = (await g(['diff', '--cached', '-U0'])).output
  const deleted = new Set((await g(['diff', '--cached', '--name-only', '--diff-filter=D'])).output.split('\n').filter(Boolean))
  await g(['reset', '-q'])
  return parseDiff(numstat, patch, deleted)
}

/** Tracked files (repo-relative). */
export async function listFiles(dir: string): Promise<string[]> {
  const r = await run('git', ['-C', dir, 'ls-files', '-z'], { timeoutMs: 60_000, maxOutput: 20_000_000 })
  return r.output.split('\0').filter(Boolean)
}

export async function headSha(dir: string, runner: Runner = run): Promise<string> {
  return (await must('rev-parse HEAD', git(dir, ['rev-parse', 'HEAD'], undefined, runner))).output.trim()
}

/** Diff between a commit and HEAD (committed changes only). */
export async function diffAgainst(dir: string, sha: string): Promise<DiffInfo> {
  const numstat = (await git(dir, ['diff', '--numstat', sha, 'HEAD'])).output
  const patch = (await git(dir, ['diff', '-U0', sha, 'HEAD'])).output
  const deleted = new Set((await git(dir, ['diff', '--name-only', '--diff-filter=D', sha, 'HEAD'])).output.split('\n').filter(Boolean))
  return parseDiff(numstat, patch, deleted)
}

/** `git diff -U<context> <sha> HEAD` as text (fixtures, the adversarial reviewer). */
export async function patchText(dir: string, sha: string, context = 0): Promise<string> {
  return (await run('git', ['-C', dir, 'diff', `-U${context}`, sha, 'HEAD'], { timeoutMs: 60_000, maxOutput: 2_000_000 })).output
}

/** Collapse everything since `sha` into one commit. */
export async function squashOnto(dir: string, sha: string, message: string): Promise<void> {
  await must('reset --soft', git(dir, ['reset', '-q', '--soft', sha]))
  await must('commit', git(dir, ['commit', '-q', '--no-verify', '-m', message]))
}

export async function commitAll(dir: string, message: string, runner: Runner = run): Promise<void> {
  await must('add', git(dir, ['add', '-A'], undefined, runner))
  // --no-verify: the repo's own checks already ran under the factory's judge; hooks may not be installed here.
  await must('commit', git(dir, ['commit', '-q', '--no-verify', '-m', message], undefined, runner))
}

/**
 * Apply a patch produced in the sandbox to the host clone and commit it. Only file contents
 * cross the boundary: nothing from the repo is executed on the host (no install, no checks,
 * no hooks — `--no-verify`).
 */
export async function applyPatchAndCommit(dir: string, patchFile: string, message: string): Promise<void> {
  await must('apply', git(dir, ['apply', '--index', '--binary', '--whitespace=nowarn', patchFile]))
  await must('commit', git(dir, ['commit', '-q', '--no-verify', '-m', message]))
}

/**
 * Network steps retry: a Mac waking from sleep mid-cycle drops the network for a while,
 * and a verified fix shouldn't be lost to that (a push failed with no output after sleep).
 */
async function withRetry(label: string, attempts: number, fn: () => ReturnType<typeof run>) {
  let last: Awaited<ReturnType<typeof run>> | null = null
  for (let i = 1; i <= attempts; i++) {
    last = await fn()
    if (last.code === 0) return last
    if (i < attempts) await new Promise(r => setTimeout(r, 20_000 * i))
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${last!.output.trim().split('\n').slice(-3).join(' | ') || '(no output — network down?)'}`)
}

export async function pushBranch(dir: string, branch: string): Promise<void> {
  await withRetry('push', 3, () => run('git', ['-C', dir, ...CRED, 'push', '-q', '-u', 'origin', branch], { timeoutMs: 180_000 }))
}

export async function createDraftPr(dir: string, opts: { base: string; head: string; title: string; body: string }): Promise<string> {
  const r = await withRetry('gh pr create', 3, () => run('gh', ['pr', 'create', '--draft', '--base', opts.base, '--head', opts.head, '--title', opts.title, '--body', opts.body], { cwd: dir, timeoutMs: 120_000 }))
  const url = r.output.match(/https:\/\/github\.com\/\S+\/pull\/\d+/)?.[0]
  if (!url) throw new Error(`gh pr create returned no URL: ${r.output.slice(-200)}`)
  return url
}

/** Add a label to a PR, creating it in the repo first if needed. Best-effort: false on failure. */
export async function addPrLabel(prUrl: string, repo: string, label: string): Promise<boolean> {
  await run('gh', ['label', 'create', label, '--repo', repo, '--color', 'FBCA04', '--description', 'RepoHQ factory: the adversarial reviewer raised concerns', '--force'], { timeoutMs: 60_000 })
  return (await run('gh', ['pr', 'edit', prUrl, '--add-label', label], { timeoutMs: 60_000 })).code === 0
}

/** Create (or refresh) the `value:0`…`value:5` rating labels in a repo; true when all exist. */
export async function ensureValueLabels(repo: string): Promise<boolean> {
  let ok = true
  for (const l of PR_VALUE_LABELS) {
    const r = await run('gh', ['label', 'create', l.name, '--repo', repo, '--color', l.color, '--description', l.description, '--force'], { timeoutMs: 60_000 })
    ok &&= r.code === 0
  }
  return ok
}

/** A PR's label names; null when gh fails. */
export async function prLabels(url: string): Promise<string[] | null> {
  const r = await run('gh', ['pr', 'view', url, '--json', 'labels', '--jq', '[.labels[].name]'], { timeoutMs: 60_000 })
  if (r.code !== 0) return null
  try {
    const names = JSON.parse(r.output) as unknown
    return Array.isArray(names) ? names.filter((n): n is string => typeof n === 'string') : null
  } catch {
    return null
  }
}

export type PrState = 'OPEN' | 'MERGED' | 'CLOSED' | 'UNKNOWN'

export async function prState(url: string): Promise<PrState> {
  const r = await run('gh', ['pr', 'view', url, '--json', 'state', '--jq', '.state'], { timeoutMs: 60_000 })
  const s = r.output.trim()
  return s === 'OPEN' || s === 'MERGED' || s === 'CLOSED' ? s : 'UNKNOWN'
}

export async function repoVisibility(fullName: string): Promise<string> {
  const r = await run('gh', ['repo', 'view', fullName, '--json', 'visibility', '--jq', '.visibility'], { timeoutMs: 60_000 })
  return r.code === 0 ? r.output.trim().toLowerCase() : 'private' // unknown → most restrictive
}

export interface PrReviewSummary {
  /** Copilot finished a review. */
  reviewed: boolean
  /** Inline comments Copilot left (each is a suggested problem). */
  comments: number
  /** First lines of Copilot's comments, for the morning report. */
  highlights: string[]
}

export function summarizeCopilotReview(json: unknown): PrReviewSummary {
  const d = json as { reviews?: { author?: { login?: string }; body?: string }[]; comments?: { author?: { login?: string }; body?: string }[] }
  const byCopilot = (a?: { login?: string }) => /copilot/i.test(a?.login ?? '')
  const reviews = (d.reviews ?? []).filter(r => byCopilot(r.author))
  return {
    reviewed: reviews.length > 0,
    comments: 0,
    highlights: reviews.map(r => (r.body ?? '').split('\n').find(l => l.trim().length > 0)?.trim() ?? '').filter(Boolean).slice(0, 2),
  }
}
