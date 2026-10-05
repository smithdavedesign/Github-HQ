import { appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'
import { parseDiff, type DiffInfo } from './verify'
import { run } from './proc'

// Use gh as the credential helper per command — no global git config changes.
const CRED = ['-c', 'credential.helper=', '-c', 'credential.helper=!gh auth git-credential']

async function git(dir: string, args: string[], timeoutMs = 120_000) {
  return run('git', ['-C', dir, ...args], { timeoutMs })
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

export async function currentBranch(dir: string): Promise<string> {
  return (await must('rev-parse', git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']))).output.trim()
}

export async function checkoutNewBranch(dir: string, base: string, branch: string): Promise<void> {
  await resetWorktree(dir)
  await must('checkout base', git(dir, ['checkout', '-q', base]))
  await must('checkout -B', git(dir, ['checkout', '-q', '-B', branch]))
}

/** Discard all tracked changes and untracked files (ignored files such as node_modules survive). */
export async function resetWorktree(dir: string): Promise<void> {
  await git(dir, ['reset', '-q', '--hard'])
  await git(dir, ['clean', '-q', '-fd'])
}

export async function diffInfo(dir: string): Promise<DiffInfo> {
  await git(dir, ['add', '-A'])
  const numstat = (await git(dir, ['diff', '--cached', '--numstat'])).output
  const patch = (await git(dir, ['diff', '--cached', '-U0'])).output
  const deleted = new Set((await git(dir, ['diff', '--cached', '--name-only', '--diff-filter=D'])).output.split('\n').filter(Boolean))
  await git(dir, ['reset', '-q'])
  return parseDiff(numstat, patch, deleted)
}

export async function headSha(dir: string): Promise<string> {
  return (await must('rev-parse HEAD', git(dir, ['rev-parse', 'HEAD']))).output.trim()
}

/** Diff between a commit and HEAD (committed changes only). */
export async function diffAgainst(dir: string, sha: string): Promise<DiffInfo> {
  const numstat = (await git(dir, ['diff', '--numstat', sha, 'HEAD'])).output
  const patch = (await git(dir, ['diff', '-U0', sha, 'HEAD'])).output
  const deleted = new Set((await git(dir, ['diff', '--name-only', '--diff-filter=D', sha, 'HEAD'])).output.split('\n').filter(Boolean))
  return parseDiff(numstat, patch, deleted)
}

/** Collapse everything since `sha` into one commit. */
export async function squashOnto(dir: string, sha: string, message: string): Promise<void> {
  await must('reset --soft', git(dir, ['reset', '-q', '--soft', sha]))
  await must('commit', git(dir, ['commit', '-q', '--no-verify', '-m', message]))
}

export async function commitAll(dir: string, message: string): Promise<void> {
  await must('add', git(dir, ['add', '-A']))
  // --no-verify: the repo's own checks already ran under the factory's judge; hooks may not be installed here.
  await must('commit', git(dir, ['commit', '-q', '--no-verify', '-m', message]))
}

export async function pushBranch(dir: string, branch: string): Promise<void> {
  await must('push', run('git', ['-C', dir, ...CRED, 'push', '-q', '-u', 'origin', branch], { timeoutMs: 180_000 }))
}

export async function createDraftPr(dir: string, opts: { base: string; head: string; title: string; body: string }): Promise<string> {
  const r = await must('gh pr create', run('gh', ['pr', 'create', '--draft', '--base', opts.base, '--head', opts.head, '--title', opts.title, '--body', opts.body], { cwd: dir, timeoutMs: 120_000 }))
  const url = r.output.match(/https:\/\/github\.com\/\S+\/pull\/\d+/)?.[0]
  if (!url) throw new Error(`gh pr create returned no URL: ${r.output.slice(-200)}`)
  return url
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
