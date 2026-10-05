import type { AuditCounts, CheckResult } from './checks'
import type { FactoryTask } from './tasks'

/**
 * The gate between "a model changed some files" and "open a PR". Enforced
 * outside the model (docs/autonomous-factory.md §11): free models are weaker,
 * so they get an objective judge that can't be talked around.
 */

export interface DiffFile {
  path: string
  added: number
  removed: number
  deleted: boolean
}

export interface DiffInfo {
  files: DiffFile[]
  /** Added lines (without the leading '+'). */
  addedLines: string[]
  /** Removed lines (without the leading '-'). Optional for callers that only track additions. */
  removedLines?: string[]
  /** Added lines per file (from the `+++ b/<path>` headers). */
  addedLinesByFile?: Record<string, string[]>
}

export interface Verdict {
  ok: boolean
  reason: string
}

export const MAX_CHANGED_LINES = 400

const FORBIDDEN_PATHS = [
  /^\.github\//,
  /(^|\/)\.env(\.|$)/,
  /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb?)$/,
  /(^|\/)node_modules\//,
]

/** Check-silencing patterns a model might use to "pass". */
const CHEATS: [RegExp, string][] = [
  [/@ts-(ignore|nocheck|expect-error)/, 'adds a TypeScript suppression'],
  [/eslint-disable/, 'disables ESLint'],
  [/\b(it|test|describe)\.(skip|only|todo|skipIf|runIf)\b|\bx(it|describe)\s*\(/, 'skips or focuses tests'],
]

/**
 * An added `if (…) return` inside a test file makes assertions silently not run — the
 * same as .skip without saying so (a free model "fixed" key-dependent smoke tests this way).
 */
const TEST_EARLY_RETURN = /^\s*if\s*\(.*\)\s*(\{\s*)?return\b/

const TEST_FILE = /(^|\/)(__tests__|tests?)\/|\.(test|spec)\.[cm]?[jt]sx?$/

export function judge(input: {
  task: FactoryTask
  baseline: CheckResult[]
  after: CheckResult[]
  diff: DiffInfo
  scripts?: Record<string, string>
  /** Names of the repo's dependencies + devDependencies (for `npx <tool>` checks). */
  deps?: string[]
  readmeAfter?: string | null
  /** deps-audit only: npm audit before/after. */
  audit?: { before: AuditCounts | null; after: AuditCounts | null }
}): Verdict {
  const { task, baseline, after, diff } = input

  if (diff.files.length === 0) return { ok: false, reason: 'no changes made' }
  if (task.kind === 'deps-audit') return judgeDeps(diff, baseline, after, input.audit)

  const forbidden = diff.files.find(f => FORBIDDEN_PATHS.some(re => re.test(f.path)))
  if (forbidden) return { ok: false, reason: `touched forbidden path ${forbidden.path}` }

  const changed = diff.files.reduce((n, f) => n + f.added + f.removed, 0)
  if (changed > MAX_CHANGED_LINES) return { ok: false, reason: `diff too large (${changed} lines > ${MAX_CHANGED_LINES})` }

  for (const [re, what] of CHEATS) {
    if (diff.addedLines.some(l => re.test(l))) return { ok: false, reason: `change ${what}` }
  }
  for (const [file, lines] of Object.entries(diff.addedLinesByFile ?? {})) {
    if (TEST_FILE.test(file) && lines.some(l => TEST_EARLY_RETURN.test(l))) {
      return { ok: false, reason: `adds an early return in ${file}, so assertions silently don't run` }
    }
  }

  const deletedTest = diff.files.find(f => f.deleted && TEST_FILE.test(f.path))
  if (deletedTest) return { ok: false, reason: `deleted test file ${deletedTest.path}` }

  if (task.kind === 'docs-readme') return judgeReadme(diff, input.scripts ?? {}, input.deps ?? [], input.readmeAfter ?? null)

  if (task.scoped && task.files.length > 0) {
    const outside = diff.files.filter(f => !task.files.includes(f.path))
    if (outside.length > 0) return { ok: false, reason: `scoped task edited other files: ${outside.map(f => f.path).join(', ')}` }
  }
  if (task.kind !== 'fix-tests') {
    const testEdits = diff.files.filter(f => TEST_FILE.test(f.path) && !task.files.includes(f.path))
    if (testEdits.length > 0) return { ok: false, reason: `edited tests for a ${task.kind} task: ${testEdits.map(f => f.path).join(', ')}` }
  }

  for (const name of task.verify) {
    const r = after.find(a => a.name === name)
    if (!r) return { ok: false, reason: `check ${name} did not run` }
    if (!r.ok) return { ok: false, reason: `${name} still fails${r.timedOut ? ' (timed out)' : ''}` }
  }

  const regressed = baseline.filter(b => b.ok).filter(b => !after.find(a => a.name === b.name)?.ok)
  if (regressed.length > 0) return { ok: false, reason: `regressed: ${regressed.map(r => r.name).join(', ')} now fail` }

  return { ok: true, reason: `${task.verify.join(' + ')} pass; no regressions; ${changed} lines in ${diff.files.length} file(s)` }
}

/** Removed README lines that aren't re-added elsewhere — real deletions, not moves. */
export const MAX_README_DELETIONS = 2

function judgeReadme(diff: DiffInfo, scripts: Record<string, string>, deps: string[], readme: string | null): Verdict {
  const other = diff.files.filter(f => !/^readme\.md$/i.test(f.path))
  if (other.length > 0) return { ok: false, reason: `docs task edited non-README files: ${other.map(f => f.path).join(', ')}` }
  const f = diff.files[0]
  if (f.added <= f.removed) return { ok: false, reason: 'README did not grow' }
  if (!readme) return { ok: false, reason: 'README missing after change' }

  // Additive only: existing content may move but not disappear (a 7B model replaced a Features list with Usage).
  const after = new Set(readme.split('\n').map(l => l.trim()))
  const deleted = (diff.removedLines ?? []).map(l => l.trim()).filter(l => l.length > 0 && !after.has(l))
  if (deleted.length > MAX_README_DELETIONS) return { ok: false, reason: `README deleted ${deleted.length} existing lines (e.g. "${deleted[0].slice(0, 60)}")` }

  const placeholder = PLACEHOLDERS.find(re => re.test(readme))
  if (placeholder) return { ok: false, reason: `README contains placeholder text (${placeholder.source})` }
  const invented = referencedScripts(readme).filter(name => !(name in scripts))
  if (invented.length > 0) return { ok: false, reason: `README references non-existent scripts: ${invented.join(', ')}` }
  const unknownTools = referencedNpxTools(readme).filter(t => !deps.includes(BIN_TO_PACKAGE[t] ?? t) && !NPX_ONE_OFFS.test(t))
  if (unknownTools.length > 0) return { ok: false, reason: `README runs tools the project doesn't depend on: npx ${unknownTools.join(', npx ')}` }
  return { ok: true, reason: `README +${f.added}/-${f.removed} lines (additive); all referenced scripts and tools exist` }
}

/** Binaries whose package has a different name. */
const BIN_TO_PACKAGE: Record<string, string> = { tsc: 'typescript', 'drizzle-kit': 'drizzle-kit', playwright: '@playwright/test' }

/** Scaffolders and one-off CLIs that are fine to npx without being a dependency. */
const NPX_ONE_OFFS = /^(create-|degit$|vercel$|netlify-cli$|serve$|http-server$|npm-check-updates$|supabase$)/

/** Packages invoked via `npx <pkg>` inside code spans/blocks (flags skipped). */
export function referencedNpxTools(readme: string): string[] {
  const code = [...readme.matchAll(/```[\s\S]*?```|`[^`\n]+`/g)].map(m => m[0]).join('\n')
  const tools = new Set<string>()
  for (const m of code.matchAll(/\bnpx\s+(?:(?:-y|--yes|--no-install)\s+)*(@?[a-z0-9][\w./@-]*)/gi)) {
    tools.add(packageName(m[1]))
  }
  return [...tools]
}

/** "@scope/pkg@1.2" → "@scope/pkg", "pkg@latest" → "pkg", trailing punctuation dropped. */
function packageName(raw: string): string {
  const clean = raw.replace(/[.:,]+$/, '')
  return clean.startsWith('@') ? clean.split('@').slice(0, 2).join('@') : clean.split('@')[0]
}

/** Template filler small models emit instead of real values. */
const PLACEHOLDERS = [/your-?user-?name/i, /<your[-_ ]/i, /\byour[-_]repo(sitory)?\b/i, /YOUR_[A-Z_]+_HERE/, /\bTODO: fill/i]

// `test` and `start` are deliberately absent: `npm test` fails unless a test script exists.
const PM_BUILTINS = new Set([
  'install', 'ci', 'run', 'i', 'add', 'dlx', 'exec', 'create', 'init', 'audit',
  'outdated', 'update', 'upgrade', 'link', 'remove', 'uninstall', 'x', 'why', 'version', 'publish', 'login',
])

/**
 * Package-manager scripts a README tells people to run. `npm run X` counts
 * anywhere; the shorthand `pnpm X` / `yarn X` only inside code, so prose like
 * "the npm scripts below" isn't mistaken for a command.
 */
export function referencedScripts(readme: string): string[] {
  const code = [...readme.matchAll(/```[\s\S]*?```|`[^`\n]+`/g)].map(m => m[0]).join('\n')
  const names = new Set<string>()
  // Script names may contain '.', ':' or '-', but sentence punctuation may follow them.
  const clean = (s: string) => s.replace(/[.:-]+$/, '')
  for (const m of readme.matchAll(/\b(?:npm|pnpm|yarn|bun)\s+run\s+([a-z][\w:.-]*)/gi)) names.add(clean(m[1]))
  for (const m of code.matchAll(/\b(?:npm|pnpm|yarn|bun)\s+([a-z][\w:.-]*)/gi)) {
    if (!PM_BUILTINS.has(m[1].toLowerCase())) names.add(clean(m[1]))
  }
  return [...names]
}

/** Parse `git diff --numstat` + `git diff -U0` output. */
export function parseDiff(numstat: string, patch: string, deleted: Set<string>): DiffInfo {
  const files: DiffFile[] = numstat.split('\n').filter(Boolean).map(line => {
    const [a, r, ...p] = line.split('\t')
    const filePath = p.join('\t')
    return { path: filePath, added: Number(a) || 0, removed: Number(r) || 0, deleted: deleted.has(filePath) }
  })
  const lines = patch.split('\n')
  const addedLines = lines.filter(l => l.startsWith('+') && !l.startsWith('+++')).map(l => l.slice(1))
  const removedLines = lines.filter(l => l.startsWith('-') && !l.startsWith('---')).map(l => l.slice(1))
  const addedLinesByFile: Record<string, string[]> = {}
  let current: string | null = null
  for (const l of lines) {
    if (l.startsWith('+++ ')) current = l.startsWith('+++ b/') ? l.slice(6) : null
    else if (current && l.startsWith('+')) (addedLinesByFile[current] ??= []).push(l.slice(1))
  }
  return { files, addedLines, removedLines, addedLinesByFile }
}

/**
 * deps-audit: only package.json + package-lock.json may change (lockfile diffs are
 * exempt from the size cap), high+critical must drop, and no check may regress.
 */
function judgeDeps(diff: DiffInfo, baseline: CheckResult[], after: CheckResult[], audit?: { before: AuditCounts | null; after: AuditCounts | null }): Verdict {
  const other = diff.files.filter(f => f.path !== 'package.json' && f.path !== 'package-lock.json')
  if (other.length > 0) return { ok: false, reason: `deps task edited non-package files: ${other.map(f => f.path).join(', ')}` }
  if (!audit?.before || !audit.after) return { ok: false, reason: 'npm audit result unavailable' }
  const serious = (a: AuditCounts) => a.critical + a.high
  if (serious(audit.after) >= serious(audit.before)) return { ok: false, reason: `high+critical did not drop (${serious(audit.before)} → ${serious(audit.after)})` }
  const regressed = baseline.filter(b => b.ok).filter(b => !after.find(a => a.name === b.name)?.ok)
  if (regressed.length > 0) return { ok: false, reason: `regressed: ${regressed.map(r => r.name).join(', ')} now fail` }
  return { ok: true, reason: `high+critical ${serious(audit.before)} → ${serious(audit.after)}; no regressions` }
}
