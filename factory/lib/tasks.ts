import type { ModelTier, TaskTier } from '../../src/lib/agents/model-router'
import { errorExcerpt, filesFromEslintOutput, filesFromTscOutput, type CheckName, type CheckResult, type CheckSpec, type PackageJson } from './checks'

/**
 * Turn scan results into concrete, verifiable tasks. Only work with an
 * objective pass/fail check is in scope (architecture.md Tier 1–2); features,
 * auth, payments and migrations never are.
 */

export type TaskKind = 'fix-types' | 'fix-lint' | 'fix-tests' | 'docs-readme'

export interface FactoryTask {
  kind: TaskKind
  taskTier: TaskTier
  /** Confined to `files` — required for M0. */
  scoped: boolean
  files: string[]
  title: string
  objective: string
  evidence: string
  /** Checks that must pass after the fix (all previously-passing checks must also still pass). */
  verify: CheckName[]
}

/** Max files for a task to count as scoped (M0-eligible). */
export const SCOPED_MAX_FILES = 3

/**
 * Max combined size of the files M0 must read and re-emit. qwen2.5-coder-7b has
 * a 16k-token window; a 37KB README (~10k tokens) timed out even with diff edits.
 */
export const M0_MAX_BYTES = 12_000

/** Demote tasks whose target files don't fit the local model's window to unscoped (M1+). */
export function fitLocalContext(task: FactoryTask, sizeOf: (file: string) => number): FactoryTask {
  if (!task.scoped) return task
  const total = task.files.reduce((n, f) => n + sizeOf(f), 0)
  return total <= M0_MAX_BYTES ? task : { ...task, scoped: false }
}

export function tasksFromScan(results: CheckResult[], specs: CheckSpec[], readmeProblem: string | null, root: string): FactoryTask[] {
  const tasks: FactoryTask[] = []
  const cmd = (n: CheckName) => specs.find(s => s.name === n)?.display ?? n
  const failed = (n: CheckName) => results.find(r => r.name === n && !r.ok)

  const tc = failed('typecheck')
  if (tc && !tc.timedOut) {
    const files = filesFromTscOutput(tc.output)
    tasks.push({
      kind: 'fix-types', taskTier: 2,
      scoped: files.length > 0 && files.length <= SCOPED_MAX_FILES, files,
      title: 'Fix type errors',
      objective: `\`${cmd('typecheck')}\` fails. Fix the type errors so it passes.`,
      evidence: errorExcerpt(tc.output), verify: ['typecheck'],
    })
  }

  const lint = failed('lint')
  if (lint && !lint.timedOut) {
    const files = filesFromEslintOutput(lint.output, root)
    tasks.push({
      kind: 'fix-lint', taskTier: 2,
      scoped: files.length > 0 && files.length <= SCOPED_MAX_FILES, files,
      title: 'Fix lint errors',
      objective: `\`${cmd('lint')}\` fails. Fix the lint errors so it passes.`,
      evidence: errorExcerpt(lint.output), verify: ['lint'],
    })
  }

  const test = failed('test')
  if (test && !test.timedOut) {
    tasks.push({
      kind: 'fix-tests', taskTier: 2, scoped: false, files: [],
      title: 'Fix failing tests',
      objective: `\`${cmd('test')}\` fails. Find the root cause and fix the code so the tests pass. Fix the code, not the tests, unless a test is clearly wrong.`,
      evidence: errorExcerpt(test.output), verify: ['test'],
    })
  }

  if (readmeProblem) {
    tasks.push({
      kind: 'docs-readme', taskTier: 1, scoped: true, files: ['README.md'],
      title: 'Improve README',
      objective: `${readmeProblem}. Improve README.md so a new developer can install, configure and run the project.`,
      evidence: readmeProblem, verify: [],
    })
  }
  return tasks
}

/** Drop tasks with an open factory PR or that keep failing (dead ends). */
export function filterTasks(tasks: FactoryTask[], repo: string, openKinds: Set<string>, deadEnds: Set<string>): FactoryTask[] {
  return tasks.filter(t => !openKinds.has(`${repo}:${t.kind}`) && !deadEnds.has(`${repo}:${t.kind}`))
}

const RULES = [
  'Make the smallest change that fixes the problem. Do not refactor unrelated code.',
  'Never silence checks: no @ts-ignore, @ts-nocheck, eslint-disable, `any` casts to dodge errors, or .skip/.only in tests.',
  'Do not edit lockfiles, CI workflows (.github/), environment files, or dependencies.',
  'Do not commit, push or create branches — the factory handles git.',
]

export function buildPrompt(task: FactoryTask, tier: ModelTier, pkg: PackageJson | null, checkCommands: string[], repo?: string): string {
  if (task.kind === 'docs-readme') {
    const scripts = Object.keys(pkg?.scripts ?? {})
    return [
      task.objective,
      `Project: ${pkg?.name ?? 'unknown'}${pkg?.description ? ` — ${pkg.description}` : ''}.`,
      ...(repo ? [`Repository: https://github.com/${repo} (use this exact URL for git clone).`] : []),
      'Never write placeholders such as "yourusername" or "<your-...>" — use real values or leave that detail out.',
      scripts.length > 0 ? `Available npm scripts (only document these, never invent commands): ${scripts.join(', ')}.` : 'There are no npm scripts — do not invent any.',
      'ADD the missing section(s). Do not delete, rename or rewrite any existing line — existing content must stay.',
      tier === 'M0' ? 'Only mention tools and commands that appear in the project files you were given.' : 'Read the code and config (package.json, .env.example, config files) so setup steps are accurate.',
      'Only edit README.md.',
    ].join('\n')
  }

  const lines = [
    task.objective,
    '',
    'Errors:',
    '```',
    // The 7B local model has a 16k window; keep its evidence short.
    tier === 'M0' ? task.evidence.slice(0, 2500) : task.evidence,
    '```',
    '',
    ...RULES.map(r => `- ${r}`),
  ]
  if (tier !== 'M0' && checkCommands.length > 0) {
    lines.push(`- When done, run ${checkCommands.map(c => `\`${c}\``).join(' and ')} to confirm, and iterate until they pass.`)
  }
  if (task.scoped && task.files.length > 0) lines.push(`- The errors are in: ${task.files.join(', ')}.`)
  return lines.join('\n')
}
