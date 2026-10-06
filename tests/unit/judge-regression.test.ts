/**
 * Judge regression suite (roadmap Phase 77). Every fixture in factory/judge-fixtures/ is a
 * verdict the judge once got wrong (a voided attempt, a PR closed in review) or a rule it
 * must keep enforcing. Add one with `npm run factory:judge-fixture -- <attemptId> --expect=…`.
 */
import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CheckResult } from '../../factory/lib/checks'
import { judge, parsePatch } from '../../factory/lib/verify'
import { loadFixture, type JudgeFixture } from '../../factory/lib/judge-fixture'

const DIR = path.resolve(__dirname, '../../factory/judge-fixtures')
const fixtures = readdirSync(DIR).filter(f => f.endsWith('.json')).map(f => loadFixture(readFileSync(path.join(DIR, f), 'utf8')))

const checks = (cs: JudgeFixture['baseline']): CheckResult[] => cs.map(c => ({ name: c.name, ok: c.ok, output: c.output ?? '', durationMs: 0, timedOut: false }))

describe('judge regression fixtures', () => {
  it('has fixtures for every past judge incident', () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(10)
  })
  for (const f of fixtures) {
    it(`${f.expect === 'accept' ? 'accepts' : 'rejects'} ${f.name} — ${f.source}`, () => {
      const diff = parsePatch(f.patch)
      const v = judge({
        task: f.task, baseline: checks(f.baseline), after: checks(f.after), diff,
        scripts: f.scripts, deps: f.deps, readmeAfter: f.readmeAfter ?? null, repo: f.repo,
        repoFiles: f.repoFiles, modelEdits: f.modelEditsPatch ? parsePatch(f.modelEditsPatch) : undefined,
        lintProblems: f.lintProblems, audit: f.audit,
      })
      expect(v.ok, v.reason).toBe(f.expect === 'accept')
      if (f.reason) expect(v.reason).toContain(f.reason)
    })
  }
})
