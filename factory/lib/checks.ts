import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { run } from './proc'

/**
 * Deterministic repo checks — the factory's "sense" step. No LLM involved:
 * the repo's own typecheck / lint / test scripts are the source of findings
 * and, after a fix, the verification gate.
 */

export type CheckName = 'typecheck' | 'lint' | 'test'
export type PackageManager = 'npm' | 'pnpm' | 'yarn' | 'bun'

export interface CheckSpec {
  name: CheckName
  cmd: string
  args: string[]
  /** Human-readable command for prompts and PR bodies. */
  display: string
}

export interface CheckResult {
  name: CheckName
  ok: boolean
  output: string
  durationMs: number
  timedOut: boolean
}

export interface PackageJson {
  name?: string
  description?: string
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  workspaces?: unknown
}

export function detectPackageManager(files: Set<string>): PackageManager {
  if (files.has('pnpm-lock.yaml')) return 'pnpm'
  if (files.has('yarn.lock')) return 'yarn'
  if (files.has('bun.lockb') || files.has('bun.lock')) return 'bun'
  return 'npm'
}

export function installCommand(pm: PackageManager, files: Set<string>): { cmd: string; args: string[] } {
  switch (pm) {
    case 'pnpm': return { cmd: 'pnpm', args: ['install', '--frozen-lockfile'] }
    case 'yarn': return { cmd: 'yarn', args: ['install', '--frozen-lockfile'] }
    case 'bun': return { cmd: 'bun', args: ['install', '--frozen-lockfile'] }
    default:
      return files.has('package-lock.json')
        ? { cmd: 'npm', args: ['ci', '--no-audit', '--no-fund'] }
        : { cmd: 'npm', args: ['install', '--no-audit', '--no-fund'] }
  }
}

const PLACEHOLDER_TEST = /no test specified|^\s*(echo|exit)\b/i

export function isPlaceholderTestScript(script: string | undefined): boolean {
  return !script || PLACEHOLDER_TEST.test(script)
}

/** Watch-mode test scripts would hang the cycle — skip them. */
const WATCH_MODE = /--watch\b|\bvitest\s*$|jest\s+--watch/

export function planChecks(pkg: PackageJson, pm: PackageManager, hasTsconfig: boolean): CheckSpec[] {
  const scripts = pkg.scripts ?? {}
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  const runScript = (name: CheckName, script: string): CheckSpec =>
    ({ name, cmd: pm, args: ['run', script], display: `${pm} run ${script}` })
  const specs: CheckSpec[] = []

  const typecheck = ['typecheck', 'type-check', 'check-types', 'tsc'].find(s => scripts[s])
  if (typecheck) specs.push(runScript('typecheck', typecheck))
  else if (hasTsconfig && deps.typescript) specs.push({ name: 'typecheck', cmd: 'npx', args: ['--no-install', 'tsc', '--noEmit'], display: 'npx tsc --noEmit' })

  if (scripts.lint && !/next lint/.test(scripts.lint)) specs.push(runScript('lint', 'lint'))

  if (!isPlaceholderTestScript(scripts.test) && !WATCH_MODE.test(scripts.test ?? '')) specs.push(runScript('test', 'test'))

  return specs
}

export async function runChecks(specs: CheckSpec[], cwd: string, timeoutMs: number): Promise<CheckResult[]> {
  const results: CheckResult[] = []
  for (const s of specs) {
    const r = await run(s.cmd, s.args, { cwd, timeoutMs, env: { ...process.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' } })
    results.push({ name: s.name, ok: r.code === 0 && !r.timedOut, output: r.output, durationMs: r.durationMs, timedOut: r.timedOut })
  }
  return results
}

const SOURCE_EXT = '(?:ts|tsx|js|jsx|mjs|cjs|mts|cts|vue|svelte|astro)'

/** Repo-relative files named in tsc output (both `file(1,2): error` and `file:1:2 - error` styles). */
export function filesFromTscOutput(out: string): string[] {
  const re = new RegExp(`^\\s*([^\\s(:][^(:\\n]*?\\.${SOURCE_EXT})(?:\\(\\d+,\\d+\\)|:\\d+:\\d+)\\s*[:-]\\s*error`, 'gm')
  return unique([...out.matchAll(re)].map(m => normalize(m[1])))
}

/** Files named in ESLint's stylish output (a path line followed by indented `line:col  error` lines). */
export function filesFromEslintOutput(out: string, root: string): string[] {
  const lines = out.split('\n')
  const files: string[] = []
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i].trim()
    if (!new RegExp(`\\.${SOURCE_EXT}$`).test(line)) continue
    if (/^\s*\d+:\d+\s+(error|warning)/.test(lines[i + 1])) files.push(normalize(path.isAbsolute(line) ? path.relative(root, line) : line))
  }
  return unique(files)
}

/** The lines of a failing check worth showing a model: errors first, capped. */
export function errorExcerpt(out: string, maxLines = 60, maxChars = 6000): string {
  const lines = out.split('\n').map(l => l.trimEnd()).filter(Boolean)
  const important = lines.filter(l => /error|fail|✗|×|expected|received|assert/i.test(l))
  const chosen = (important.length > 0 ? important : lines.slice(-maxLines)).slice(0, maxLines)
  return chosen.join('\n').slice(0, maxChars)
}

const README_SECTIONS: [string, RegExp][] = [
  ['installation / setup', /^#+\s*.*(install|setup|getting started|quick ?start)/im],
  ['usage', /^#+\s*.*(usage|how to|running|run |development|scripts)/im],
]

/** Null when the README is fine; otherwise what's missing. */
export function readmeIssue(text: string | null): string | null {
  if (text === null) return 'README.md is missing'
  const body = text.replace(/<!--[\s\S]*?-->/g, '').trim()
  if (body.length < 300) return `README.md is only ${body.length} characters`
  const missing = README_SECTIONS.filter(([, re]) => !re.test(body)).map(([name]) => name)
  return missing.length > 0 ? `README.md has no ${missing.join(' or ')} section` : null
}

export function readRepoBasics(dir: string): { files: Set<string>; pkg: PackageJson | null; readme: string | null; hasTsconfig: boolean } {
  const files = new Set(readdirSync(dir))
  const pkg = files.has('package.json') ? (JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8')) as PackageJson) : null
  const readmeName = [...files].find(f => /^readme\.md$/i.test(f))
  const readme = readmeName ? readFileSync(path.join(dir, readmeName), 'utf8') : null
  return { files, pkg, readme, hasTsconfig: existsSync(path.join(dir, 'tsconfig.json')) }
}

function normalize(p: string): string {
  return p.trim().replace(/^\.\//, '')
}

function unique<T>(xs: T[]): T[] {
  return [...new Set(xs)]
}
