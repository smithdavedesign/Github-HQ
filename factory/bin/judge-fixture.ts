/**
 * Turn a recorded attempt into a judge regression fixture (roadmap Phase 77).
 *
 *   npm run factory:judge-fixture -- <attemptId> --expect=reject --source="go-adventure#1 closed: skipped tests" [--reason="early return"] [--name=slug]
 *
 * Use it whenever a verdict turns out wrong: a PR you closed in review (`--expect=reject`) or a
 * verdict you voided as a judge bug (`--expect=accept`). The fixture fails until the judge is
 * fixed, and keeps it fixed.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { loadConfig } from '../lib/config'
import { readLedger, type AttemptEntry } from '../lib/ledger'
import { fixtureFromRecord, type JudgeInputRecord } from '../lib/judge-fixture'

const FIXTURES = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'judge-fixtures')

function arg(name: string): string | undefined {
  return process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3)
}

function main() {
  const id = process.argv.slice(2).find(a => !a.startsWith('--'))
  const expectArg = arg('expect')
  const source = arg('source')
  if (!id || (expectArg !== 'accept' && expectArg !== 'reject') || !source) {
    throw new Error('usage: judge-fixture <attemptId> --expect=accept|reject --source="…" [--reason="…"] [--name=slug]')
  }
  const cfg = loadConfig()
  const attempt = readLedger(cfg.home).find((e): e is AttemptEntry => e.type === 'attempt' && e.id === id)
  if (!attempt) throw new Error(`no attempt ${id} in ${cfg.home}/ledger.jsonl`)
  const runDir = path.join(cfg.home, 'logs', attempt.runId)
  const file = existsSync(runDir) ? readdirSync(runDir).map(f => path.join(runDir, f)).find(f => f.endsWith('.judge.json') && (JSON.parse(readFileSync(f, 'utf8')) as JudgeInputRecord).attemptId === id) : undefined
  if (!file) throw new Error(`no recorded judge inputs for ${id} in ${runDir} (attempts before Phase 77 weren't recorded)`)
  const rec = JSON.parse(readFileSync(file, 'utf8')) as JudgeInputRecord
  const name = arg('name') ?? `${attempt.repo.split('/')[1]}-${attempt.kind}-${id.slice(0, 8)}`.toLowerCase().replace(/[^a-z0-9-]+/g, '-')
  const out = path.join(FIXTURES, `${name}.json`)
  writeFileSync(out, JSON.stringify(fixtureFromRecord(rec, { name, source, expect: expectArg, reason: arg('reason') }), null, 2) + '\n')
  console.log(`wrote ${path.relative(process.cwd(), out)} (judge said ${rec.verdict.ok ? 'accept' : 'reject'}: ${rec.verdict.reason}; expected ${expectArg})`)
  console.log('run: npx vitest run tests/unit/judge-regression.test.ts')
}

try { main() } catch (err) { console.error(err instanceof Error ? err.message : err); process.exit(1) }
