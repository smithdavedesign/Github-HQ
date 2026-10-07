import type { ModelTier, TaskTier } from '../../src/lib/agents/model-router'
import { errorExcerpt, filesFromEslintOutput, filesFromTscOutput, type AuditCounts, type CheckName, type CheckResult, type CheckSpec, type PackageJson } from './checks'
import { deadEndKey } from './ledger'

/**
 * Turn scan results into concrete, verifiable tasks. Only work with an
 * objective pass/fail check is in scope (architecture.md Tier 1–2); features,
 * auth, payments and migrations never are.
 */

export type TaskKind = 'fix-types' | 'lint-autofix' | 'fix-lint' | 'fix-tests' | 'deps-audit' | 'docs-readme' | 'red-ci' | 'owner-requested' | 'owner-report'

/**
 * Fixed pipelines (roadmap Phase 78): every task kind is sense → one worker step → verify → PR.
 * The Director picks the pipeline; a worker never chooses what runs next.
 */
export const PIPELINES: Record<TaskKind, string> = {
  'fix-types': 'repo typecheck fails → model fix (sandbox) → judge → PR',
  'fix-lint': 'repo lint fails → model fix (sandbox) → judge → PR',
  'fix-tests': 'repo tests fail → model fix (sandbox) → judge → PR',
  'lint-autofix': "lint script rewrites files → the repo's own fixer → judge → PR",
  'deps-audit': 'npm audit high/critical → npm audit fix (no model) → judge → PR',
  'docs-readme': 'README gaps → model edit → README judge → PR',
  'red-ci': 'base-branch workflow failing → investigate (report) or fix (pr; oracle: the workflow passes on the PR)',
  'owner-requested': 'owner asks (front door) → model (sandbox, free-pool) → judge (checks pass, no regress, diff ≤ budget) → draft PR labeled owner-requested',
  'owner-report': 'owner asks for a report (Agent HQ) → read-only investigation (sandbox, free-pool) → structured findings back to RepoHQ, no PR',
}

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
  /** red-ci: the failing workflow (its passing on the PR is the oracle). */
  ci?: { workflow: string; url: string; base: string }
  /** owner-requested / owner-report: the request id (front-door queue or agent_requests), carried through to the ledger so results correlate back. */
  ownerTaskId?: string
  /** owner-report: the gstack skill the report was asked as (shapes the prompt). */
  skill?: string
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

export function tasksFromScan(
  results: CheckResult[], specs: CheckSpec[], readmeProblem: string | null, root: string,
  audit: AuditCounts | null = null,
  /** The lint script runs a fixer: offer the mechanical autofix first, model fixes after it lands. */
  opts: { lintAutofixes?: boolean } = {},
): FactoryTask[] {
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
  if (lint && !lint.timedOut && opts.lintAutofixes) {
    // A model fix would drag the fixer's whole-repo rewrite into its diff (2,493 lines on
    // Figma-Jira) and fail the size cap; land the mechanical autofix on its own first.
    tasks.push({
      kind: 'lint-autofix', taskTier: 1, scoped: false, files: [],
      title: "Apply the repo's lint autofix",
      objective: `\`${cmd('lint')}\` runs a fixer that rewrites files. Commit the fixer's own changes as a mechanical PR so later fixes start from a clean tree.`,
      evidence: errorExcerpt(lint.output), verify: [],
    })
  } else if (lint && !lint.timedOut) {
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
  // Failures caused by missing secrets / network (live-API smoke tests) aren't code bugs —
  // a model can only "fix" them by skipping assertions. Report them, don't task them.
  if (test && !test.timedOut && !isEnvironmentFailure(test.output)) {
    tasks.push({
      kind: 'fix-tests', taskTier: 2, scoped: false, files: [],
      title: 'Fix failing tests',
      objective: `\`${cmd('test')}\` fails. Find the root cause and fix the code so the tests pass. Fix the code, not the tests, unless a test is clearly wrong.`,
      evidence: errorExcerpt(test.output), verify: ['test'],
    })
  }

  if (audit && audit.critical + audit.high > 0) {
    tasks.push({
      kind: 'deps-audit', taskTier: 2, scoped: false, files: ['package.json', 'package-lock.json'],
      title: 'Fix vulnerable dependencies',
      objective: `\`npm audit\` reports ${audit.critical} critical and ${audit.high} high severity vulnerabilities. Apply the non-breaking fixes (\`npm audit fix\`, never --force).`,
      evidence: `critical=${audit.critical} high=${audit.high} moderate=${audit.moderate} low=${audit.low}`,
      verify: [],
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

/** A red-CI task from a failing workflow run (Phase 78); `log` is the failing steps' excerpt. */
export function redCiTask(run: { workflow: string; url: string; conclusion: string }, base: string, log: string): FactoryTask {
  return {
    kind: 'red-ci', taskTier: 2, scoped: false, files: [],
    title: `Fix red CI: ${run.workflow}`,
    objective: `The "${run.workflow}" GitHub Actions workflow fails on \`${base}\` (${run.conclusion}). Find the root cause and fix the code or config so it passes. Files under .github/ can't be changed by this task.`,
    evidence: log, verify: [], ci: { workflow: run.workflow, url: run.url, base },
  }
}

/**
 * A free-form task the owner asked for via the front door (ai-stack/repohq/CONTRACT.md).
 * Unscoped (the change may span files) with no acceptance oracle of its own — the judge's
 * generic gate is the whole safety story: non-empty diff, no forbidden paths (.github/,
 * lockfiles, .env), ≤ MAX_CHANGED_LINES, no check-silencing, no test deletion/edits, and
 * no regression of any previously-passing check. It never auto-merges: the draft PR is
 * labeled `owner-requested` and reviewed as owner intent.
 */
export function ownerRequestedTask(repo: string, task: string, ownerTaskId: string, skill?: string): FactoryTask {
  const text = task.trim()
  const guidance = skill ? FIX_SKILL_GUIDANCE[skill] : undefined
  return {
    kind: 'owner-requested', taskTier: 2, scoped: false, files: [],
    title: `Owner request: ${text.length > 60 ? `${text.slice(0, 57)}…` : text}`,
    objective: `${text}${guidance ? `\n\n${guidance}` : ''}\n\nThis is an owner request for ${repo}. Make the smallest change that satisfies it. Keep all existing checks (typecheck, lint, tests) passing — do not break anything that works today.`,
    evidence: '', verify: [], ownerTaskId,
  }
}

/** Agent HQ fix skills (docs/agent-hq-migration-prd.md §8): what each asks of the change. */
const FIX_SKILL_GUIDANCE: Record<string, string> = {
  // The judge rejects test-file edits on owner requests (verify.ts), so the fix stays in source.
  qa: 'Find bugs in the area the request describes and fix them in the source code. Do not edit test files; every existing test must keep passing.',
  'document-release': 'Update README, docs and CHANGELOG so they match the code as it is today. Documentation files only: change no functional code.',
}

/** Agent HQ report skills: the focus of a read-only investigation (docs/agent-hq-migration-prd.md §8). */
const REPORT_SKILL_FOCUS: Record<string, string> = {
  review: 'Review the code like a senior reviewer before merge: security issues, logic errors, missing error handling, risky structure.',
  'qa-only': "Find bugs: run the project's checks and tests, read the code paths the request names, and list each bug with how to reproduce it.",
  health: 'Assess code health: typecheck errors, lint problems, failing or missing tests, dead code, outdated or vulnerable dependencies. End the summary with a 0–10 health score.',
  investigate: 'Find the root cause of the problem the request describes. Reproduce it if you can and point at the exact code responsible.',
  retro: "Look back at the last 7 days of commits (`git log --since='7 days ago' --stat`): what shipped, what's risky, what's unfinished.",
}

/**
 * A read-only report the owner asked for through Agent HQ (agent_requests.mode = report). It runs
 * like a red-ci investigation — one sandboxed agent run on the free pool, file changes discarded —
 * and its structured report comes back as findings. Never a PR.
 */
export function ownerReportTask(repo: string, task: string, ownerTaskId: string, skill?: string): FactoryTask {
  const text = task.trim()
  const label = skill ? `/${skill}` : 'Report'
  return {
    kind: 'owner-report', taskTier: 2, scoped: false, files: [],
    title: `${label}: ${text.length > 60 ? `${text.slice(0, 57)}…` : text}`,
    objective: text, evidence: '', verify: [], ownerTaskId, ...(skill ? { skill } : {}),
  }
}

/** Prompt for an owner report: the skill's focus, the request, and the report format parseReport reads. */
export function reportPrompt(task: FactoryTask, repo: string): string {
  const focus = (task.skill && REPORT_SKILL_FOCUS[task.skill]) ?? 'Investigate what the request asks about.'
  return [
    focus,
    '',
    `Request for ${repo}:`,
    task.objective,
    '',
    'There is no network beyond the npm registry and no secrets; say so where a check needs them.',
    'Do NOT modify any files. Finish with exactly this report:',
    '## Summary',
    '(two or three sentences)',
    '## Findings',
    '(one bullet per finding: `- path:line — what is wrong and why it matters`; write `- none` if there are none)',
    '## Evidence',
    '(file:line references, command output)',
    '## Suggested next step',
    '(one bullet: the change to make next, specific enough to queue as a fix request)',
  ].join('\n')
}

/** The report part of an owner report, or null if the model didn't produce one. */
export function parseReport(text: string): string | null {
  const start = text.search(/^#+\s*Summary/im)
  if (start < 0) return null
  const report = text.slice(start).trim()
  return /^#+\s*Findings/im.test(report) && report.length >= 60 ? report.slice(0, 6000) : null
}

/** Read-only root-cause investigation prompt (gstack /investigate, as a fixed single step). */
export function investigationPrompt(task: FactoryTask): string {
  return [
    `The "${task.ci?.workflow}" GitHub Actions workflow fails on \`${task.ci?.base}\` (${task.ci?.url}).`,
    '',
    'Failing log (excerpt):',
    '```',
    task.evidence.slice(0, 8000),
    '```',
    '',
    'Investigate the root cause. Read the code, config and workflow file; reproduce the failing command locally if you can',
    '(there is no network beyond the npm registry and no secrets, so say so if the failure needs them).',
    'Do NOT modify any files. Finish with exactly this report:',
    '## Root cause',
    '## Evidence',
    '(file:line references or log lines)',
    '## Proposed fix',
    '## Confidence',
    '(high | medium | low, and what would confirm it)',
  ].join('\n')
}

/** The report part of an investigation, or null if the model didn't produce one. */
export function parseFindings(text: string): string | null {
  const start = text.search(/^#+\s*Root cause/im)
  if (start < 0) return null
  const report = text.slice(start).trim()
  return /^#+\s*Proposed fix/im.test(report) && report.length >= 80 ? report.slice(0, 3000) : null
}

/** Drop tasks with an open factory PR or that keep failing (dead ends, keyed by `deadEndKey`). */
export function filterTasks(tasks: FactoryTask[], repo: string, openKinds: Set<string>, deadEnds: Set<string>): FactoryTask[] {
  return tasks.filter(t => !openKinds.has(`${repo}:${t.kind}`) && !deadEnds.has(deadEndKey(repo, t.kind, t.ownerTaskId)))
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

  if (task.kind === 'owner-requested') {
    const lines = [
      task.objective,
      ...(repo ? ['', `Repository: https://github.com/${repo} (use this exact URL for git clone).`] : []),
      '',
      ...RULES.map(r => `- ${r}`),
    ]
    if (checkCommands.length > 0) lines.push(`- When done, run ${checkCommands.map(c => `\`${c}\``).join(' and ')} and iterate until they pass.`)
    return lines.join('\n')
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

const ENV_FAILURE = /\b[A-Z][A-Z0-9_]*_(API_KEY|KEY|TOKEN|SECRET)\b.*(must be set|not set|missing|undefined|required)|(must be set|not set|missing|required)\b.*\b[A-Z][A-Z0-9_]*_(API_KEY|KEY|TOKEN|SECRET)\b|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|fetch failed|getaddrinfo/i

/** A test failure caused by the factory's environment (no secrets, no network), not by the code. */
export function isEnvironmentFailure(output: string): boolean {
  return ENV_FAILURE.test(output)
}
