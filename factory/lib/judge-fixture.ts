import type { AuditCounts, CheckName } from './checks'
import type { FactoryTask } from './tasks'

/**
 * Judge regression fixtures (roadmap Phase 77): the exact inputs the judge saw for one attempt,
 * plus the verdict it *should* have reached. The factory saves the inputs of every attempt
 * (`<log dir>/<repo>-<kind>-<tier>.judge.json`); `npm run factory:judge-fixture` turns one into
 * a fixture under factory/judge-fixtures/, and tests/unit/judge-regression.test.ts replays them.
 */

export interface FixtureCheck { name: CheckName; ok: boolean; output?: string }

/** What run.ts records for every judged attempt. */
export interface JudgeInputRecord {
  attemptId: string
  repo: string
  task: FactoryTask
  baseline: FixtureCheck[]
  after: FixtureCheck[]
  /** `git diff -U0 <base> HEAD` of what was judged. */
  patch: string
  /** The model's own edits before the repo's fixer ran, when they differ. */
  modelEditsPatch?: string
  scripts?: Record<string, string>
  deps?: string[]
  readmeAfter?: string | null
  repoFiles?: string[]
  lintProblems?: { before: number | null; after: number | null }
  audit?: { before: AuditCounts | null; after: AuditCounts | null }
  /** The verdict the judge actually gave. */
  verdict: { ok: boolean; reason: string }
}

export interface JudgeFixture extends Omit<JudgeInputRecord, 'attemptId' | 'verdict' | 'repo'> {
  name: string
  /** Where this case came from (PR, incident, rule). */
  source: string
  expect: 'accept' | 'reject'
  /** Substring the judge's reason must contain. */
  reason?: string
  repo?: string
}

/** Check output is trimmed to what rules read (coverage summary, lint totals), keeping fixtures small. */
export const FIXTURE_OUTPUT_CHARS = 4_000

export function trimCheck(c: { name: CheckName; ok: boolean; output: string }): FixtureCheck {
  return { name: c.name, ok: c.ok, output: c.output.slice(-FIXTURE_OUTPUT_CHARS) }
}

export function loadFixture(json: string): JudgeFixture {
  const f = JSON.parse(json) as JudgeFixture
  for (const k of ['name', 'source', 'expect', 'task', 'patch'] as const) {
    if (f[k] === undefined) throw new Error(`judge fixture ${f.name ?? '?'}: missing ${k}`)
  }
  if (f.expect !== 'accept' && f.expect !== 'reject') throw new Error(`judge fixture ${f.name}: expect must be accept|reject`)
  return { ...f, baseline: f.baseline ?? [], after: f.after ?? [] }
}

/** A fixture from a recorded attempt, with the verdict a human says was right. */
export function fixtureFromRecord(rec: JudgeInputRecord, opts: { name: string; source: string; expect: 'accept' | 'reject'; reason?: string }): JudgeFixture {
  const { attemptId: _id, verdict: _v, ...inputs } = rec
  return { name: opts.name, source: opts.source, expect: opts.expect, ...(opts.reason ? { reason: opts.reason } : {}), ...inputs }
}
