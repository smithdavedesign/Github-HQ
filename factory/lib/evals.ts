import { cpSync, mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ModelTier } from '../../src/lib/agents/model-router'
import type { FactoryConfig } from './config'
import { runHarness } from './harness'
import { run } from './proc'

const FIXTURES = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../eval/fixtures')

export interface EvalCase {
  name: string
  fixture: string
  prompt: string
  readOnly?: boolean
  /** Files Aider may edit (only used for M0). */
  files?: string[]
  /** Files the agent must not modify. */
  protectedFiles: string[]
  check: (dir: string) => Promise<{ pass: boolean; detail: string }>
}

const nodeTestPasses = async (dir: string) => {
  const r = await run('node', ['test.js'], { cwd: dir, timeoutMs: 30_000 })
  return { pass: r.code === 0, detail: r.code === 0 ? 'tests pass' : `tests fail: ${r.output.trim().split('\n').slice(-2).join(' ')}` }
}

export const EVAL_CASES: EvalCase[] = [
  {
    name: 'seeded-bug',
    fixture: 'seeded-bug',
    prompt: 'Running `node test.js` fails. Find and fix the bug in calc.js. Do not modify test.js. Reply DONE when finished.',
    files: ['calc.js'],
    protectedFiles: ['test.js'],
    check: nodeTestPasses,
  },
  {
    name: 'multi-file',
    fixture: 'multi-file',
    prompt: 'Running `node test.js` fails. The bugs are somewhere under src/. Fix the source code so the tests pass. Do not modify test.js. Reply DONE when finished.',
    files: ['src/strings.js', 'src/format.js'],
    protectedFiles: ['test.js'],
    check: nodeTestPasses,
  },
  {
    name: 'read-only-report',
    fixture: 'report',
    readOnly: true,
    prompt: 'READ-ONLY code review. Do NOT modify any existing file. Review the code under src/ and write a file named report.json at the project root containing exactly {"findings": ["..."]}: one string per concrete problem, each citing the file name. Reply DONE when finished.',
    protectedFiles: ['src/app.js', 'src/config.json'],
    check: async dir => {
      const p = path.join(dir, 'report.json')
      if (!existsSync(p)) return { pass: false, detail: 'report.json missing' }
      try {
        const j = JSON.parse(readFileSync(p, 'utf8')) as { findings?: unknown }
        const f = Array.isArray(j.findings) ? j.findings.filter((x): x is string => typeof x === 'string') : []
        const text = f.join(' ').toLowerCase()
        const hits = [/divi|zero|empty|length/, /password|secret|hardcod|credential/].filter(re => re.test(text)).length
        return { pass: f.length > 0 && hits >= 1, detail: `${f.length} findings, ${hits}/2 seeded issues found` }
      } catch (e) {
        return { pass: false, detail: `report.json invalid: ${(e as Error).message}` }
      }
    },
  },
]

export interface EvalOutcome {
  model: string
  case: string
  pass: boolean
  detail: string
  durationMs: number
  rateLimited: boolean
}

/** Run one eval case against one LiteLLM alias in a throwaway copy of the fixture. */
export async function runEval(c: EvalCase, model: string, tier: ModelTier, cfg: FactoryConfig): Promise<EvalOutcome> {
  const dir = mkdtempSync(path.join(tmpdir(), `factory-eval-${c.name}-`))
  try {
    cpSync(path.join(FIXTURES, c.fixture), dir, { recursive: true })
    const before = new Map(c.protectedFiles.map(f => [f, readFileSync(path.join(dir, f), 'utf8')]))
    const h = await runHarness({ tier, model, cwd: dir, prompt: c.prompt, files: c.files, readOnly: c.readOnly, timeoutMs: 5 * 60_000 }, cfg)
    const tampered = c.protectedFiles.filter(f => !existsSync(path.join(dir, f)) || readFileSync(path.join(dir, f), 'utf8') !== before.get(f))
    if (tampered.length > 0) {
      return { model, case: c.name, pass: false, detail: `modified protected file(s): ${tampered.join(', ')}`, durationMs: h.durationMs, rateLimited: h.rateLimited }
    }
    const result = await c.check(dir)
    const detail = h.timedOut ? `timed out; ${result.detail}` : result.detail
    return { model, case: c.name, pass: result.pass, detail, durationMs: h.durationMs, rateLimited: h.rateLimited }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
