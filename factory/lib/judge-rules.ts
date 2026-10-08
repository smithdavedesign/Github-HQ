import { builtinModules } from 'node:module'
import path from 'node:path'
import type { CheckResult } from './checks'
import type { FactoryTask } from './tasks'
import type { DiffInfo, Verdict } from './verify'

/**
 * Judge v2 rules (roadmap Phase 77, docs/autonomous-factory.md §14.1 #4). All deterministic and
 * pure: each takes the diff (plus what it needs) and returns a rejection, or null to pass.
 * Every rule here exists because a weak model can turn a check green without fixing anything.
 */

type Rejection = Verdict | null
const reject = (reason: string): Verdict => ({ ok: false, reason })

export const TEST_FILE = /(^|\/)(__tests__|tests?)\/|\.(test|spec)\.[cm]?[jt]sx?$/
const SNAPSHOT = /(^|\/)__snapshots__\/|\.snap$/
const CODE_FILE = /\.(?:[cm]?[jt]sx?|mts|cts|vue|svelte)$/

// ─── Test integrity ──────────────────────────────────────────────────────────

/** One assertion per match: expect(…), assert(…)/assert.x(…), chai .should, ava t.is(…) etc. */
const ASSERTION = /\bexpect\s*\(|\bassert(?:\.\w+)?\s*\(|\.should\b|\bt\.(?:is|not|deepEqual|true|false|truthy|falsy|throws|regex)\s*\(/g

export function countAssertions(lines: string[]): number {
  return lines.reduce((n, l) => n + (l.match(ASSERTION)?.length ?? 0), 0)
}

/** Mocking the project's own modules makes the code under test disappear from the test. */
const OWN_MODULE_MOCK = /\b(?:vi|jest)\.(?:mock|doMock|unstable_mockModule)\(\s*['"`](?:\.{1,2}\/|@\/|~\/|src\/)/

/**
 * - snapshot files never change in a model task (an updated snapshot is a new expectation);
 * - a touched test file must not lose assertions overall;
 * - no new mocks of the project's own modules.
 */
export function testIntegrity(diff: DiffInfo): Rejection {
  const snap = diff.files.find(f => SNAPSHOT.test(f.path))
  if (snap) return reject(`rewrites snapshot ${snap.path} (snapshots are expectations; a human updates them)`)
  for (const f of diff.files.filter(x => TEST_FILE.test(x.path))) {
    const added = diff.addedLinesByFile?.[f.path] ?? []
    const removed = diff.removedLinesByFile?.[f.path] ?? []
    const lost = countAssertions(removed) - countAssertions(added)
    if (lost > 0) return reject(`removes ${lost} assertion(s) from ${f.path}`)
    const mock = added.find(l => OWN_MODULE_MOCK.test(l))
    if (mock) return reject(`mocks the project's own code in ${f.path} (${mock.trim().slice(0, 80)})`)
  }
  return null
}

// ─── Diff sanity ─────────────────────────────────────────────────────────────

/** Files an unscoped fix may touch beyond the ones its errors named. */
export const MAX_UNRELATED_FILES = 3
/** A model edit that is mostly re-formatting existing lines (min lines, min share). */
export const REFORMAT_MIN_LINES = 15
export const REFORMAT_SHARE = 0.6

const EXPORT_DECL = /^\s*export\s+(?:default\s+)?(?:declare\s+)?(?:async\s+)?(?:function\*?|class|const|let|var|interface|type|enum|abstract\s+class)\s+([A-Za-z_$][\w$]*)/

/** Exported names declared on these lines. */
export function exportedNames(lines: string[]): string[] {
  return lines.map(l => EXPORT_DECL.exec(l)?.[1]).filter((n): n is string => !!n)
}

/** A line with formatting stripped: whitespace, quote style, trailing commas/semicolons. */
export function normalizeFormatting(line: string): string {
  return line.replace(/\s+/g, '').replace(/["`]/g, "'").replace(/[;,]+$/, '')
}

/**
 * - no deleted non-test source files;
 * - no exported declarations removed (deleting code is not fixing it);
 * - unscoped fixes stay near the files their errors named;
 * - the model's own edits aren't a reformat of code it didn't need to touch.
 * `modelEdits` is the model's diff before the repo's own fixer ran (that fixer's
 * reformatting is legitimate and is judged as part of the full diff).
 */
export function diffSanity(task: FactoryTask, diff: DiffInfo, modelEdits?: DiffInfo): Rejection {
  const deletedSource = diff.files.find(f => f.deleted && CODE_FILE.test(f.path) && !TEST_FILE.test(f.path))
  if (deletedSource) return reject(`deletes source file ${deletedSource.path}`)

  const removedExports = new Set(exportedNames(diff.removedLines ?? []))
  for (const n of exportedNames(diff.addedLines)) removedExports.delete(n)
  if (removedExports.size > 0) return reject(`removes exported ${[...removedExports].slice(0, 3).join(', ')}`)

  if (!task.scoped && task.files.length > 0) {
    const unrelated = diff.files.filter(f => !task.files.includes(f.path) && !TEST_FILE.test(f.path))
    if (unrelated.length > MAX_UNRELATED_FILES) {
      return reject(`edits ${unrelated.length} files its errors didn't name (max ${MAX_UNRELATED_FILES}): ${unrelated.slice(0, 4).map(f => f.path).join(', ')}`)
    }
  }

  const edits = modelEdits ?? diff
  for (const f of edits.files) {
    const removed = edits.removedLinesByFile?.[f.path] ?? []
    const added = new Set((edits.addedLinesByFile?.[f.path] ?? []).map(normalizeFormatting))
    const restyled = removed.filter(l => l.trim().length > 0 && added.has(normalizeFormatting(l)) && !(edits.addedLinesByFile?.[f.path] ?? []).includes(l))
    const changed = f.added + f.removed
    if (restyled.length >= REFORMAT_MIN_LINES && (restyled.length * 2) / Math.max(changed, 1) >= REFORMAT_SHARE) {
      return reject(`reformats ${restyled.length} unchanged lines in ${f.path} (unrelated to the fix)`)
    }
  }
  return null
}

// ─── Type escapes ────────────────────────────────────────────────────────────

const ANY_CAST = /\bas\s+any\b|<any>\s*[\w(]|:\s*any\b(?!\w)/

/**
 * Type and lint fixes may not cast to `any` in source files: it turns the check green and
 * leaves the bug (found by the adversarial reviewer on the seeded e2e error before any rule did).
 */
export function typeEscapes(task: FactoryTask, diff: DiffInfo): Rejection {
  if (task.kind !== 'fix-types' && task.kind !== 'fix-lint') return null
  for (const [file, lines] of Object.entries(diff.addedLinesByFile ?? {})) {
    if (!CODE_FILE.test(file) || TEST_FILE.test(file)) continue
    const before = (diff.removedLinesByFile?.[file] ?? []).filter(l => ANY_CAST.test(l)).length
    const added = lines.filter(l => ANY_CAST.test(l) && !/^\s*(\/\/|\*)/.test(l))
    if (added.length > before) return reject(`casts to any in ${file} (${added[0].trim().slice(0, 80)})`)
  }
  return null
}

// ─── Import validation ───────────────────────────────────────────────────────

const IMPORT_SPEC = /(?:\bfrom\s+|\bimport\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)['"]([^'"\n]+)['"]/g
const BUILTINS = new Set(builtinModules.flatMap(m => [m, m.replace(/^node:/, '')]))
/** Path aliases and virtual modules: resolved by the bundler/tsconfig, not package.json. */
const ALIAS = /^(?:@\/|~\/|#|\$|virtual:|astro:|bun:)/
const RESOLVE_EXT = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.json', '.vue', '.svelte', '.d.ts']

export function importSpecifiers(lines: string[]): string[] {
  const out = new Set<string>()
  for (const l of lines) {
    if (/^\s*(\/\/|\*|\/\*)/.test(l)) continue
    for (const m of l.matchAll(IMPORT_SPEC)) out.add(m[1])
  }
  return [...out]
}

/** "@scope/pkg/sub" → "@scope/pkg", "pkg/sub" → "pkg". */
export function packageOf(spec: string): string {
  const parts = spec.split('/')
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

/** Repo-relative path a relative import from `fromFile` resolves to, if one of the files exists. */
export function resolveRelative(fromFile: string, spec: string, files: Set<string>): string | null {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), spec.split('?')[0]))
  // ESM TypeScript imports name the emitted .js file.
  const stems = [base, base.replace(/\.(m|c)?js$/, '.$1ts'), base.replace(/\.jsx$/, '.tsx')]
  for (const stem of stems) {
    for (const ext of RESOLVE_EXT) if (files.has(stem + ext)) return stem + ext
    for (const ext of RESOLVE_EXT.slice(1)) if (files.has(`${stem}/index${ext}`)) return `${stem}/index${ext}`
  }
  return null
}

/**
 * New imports must resolve: bare specifiers to a declared dependency (or a Node builtin),
 * relative ones to a file in the repo after the change. Only imports the diff adds are
 * checked; one that also appears in a removed line was moved, not introduced.
 */
export function importValidation(diff: DiffInfo, deps: string[], repoFiles?: string[]): Rejection {
  const declared = new Set(deps)
  const files = repoFiles ? new Set(repoFiles) : null
  for (const [file, lines] of Object.entries(diff.addedLinesByFile ?? {})) {
    if (!CODE_FILE.test(file)) continue
    const before = new Set(importSpecifiers(diff.removedLinesByFile?.[file] ?? []))
    for (const spec of importSpecifiers(lines)) {
      if (before.has(spec) || ALIAS.test(spec)) continue
      if (spec.startsWith('.') || spec.startsWith('/')) {
        if (files && spec.startsWith('.') && !resolveRelative(file, spec, files)) return reject(`imports a file that doesn't exist: '${spec}' in ${file}`)
        continue
      }
      if (spec.startsWith('node:') || BUILTINS.has(spec) || BUILTINS.has(packageOf(spec))) continue
      if (!declared.has(packageOf(spec)) && !declared.has(`@types/${packageOf(spec)}`)) return reject(`imports undeclared package '${packageOf(spec)}' in ${file}`)
    }
  }
  return null
}

// ─── Coverage ────────────────────────────────────────────────────────────────

/** Coverage may drop by this many points (rounding, tiny refactors) before the judge objects. */
export const COVERAGE_TOLERANCE = 0.5

/** Statement coverage % from an Istanbul text summary ("All files | 84.21 | …"), or null. */
export function coveragePct(output: string): number | null {
  const m = /^\s*All files\s*\|\s*([\d.]+)/m.exec(output)
  return m ? Number(m[1]) : null
}

/** Only for repos whose test script already prints coverage, before and after. */
export function coverageDelta(baseline: CheckResult[], after: CheckResult[]): Rejection {
  const before = coveragePct(baseline.find(b => b.name === 'test')?.output ?? '')
  const now = coveragePct(after.find(a => a.name === 'test')?.output ?? '')
  if (before == null || now == null) return null
  if (now < before - COVERAGE_TOLERANCE) return reject(`test coverage dropped ${before}% → ${now}%`)
  return null
}
