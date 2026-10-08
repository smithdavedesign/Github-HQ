import { describe, expect, it } from 'vitest'
import {
  countAssertions, coverageDelta, coveragePct, diffSanity, exportedNames, importSpecifiers, importValidation,
  normalizeFormatting, packageOf, resolveRelative, testIntegrity, typeEscapes,
} from '../../factory/lib/judge-rules'
import {
  adversaryAction, adversarySection, buildAdversaryPrompt, parseAdversaryReply, reviewerModel, runAdversary, CHECKLIST,
} from '../../factory/lib/adversary'
import { fixtureFromRecord, loadFixture, trimCheck, type JudgeInputRecord } from '../../factory/lib/judge-fixture'
import { DEFAULT_CAPABILITIES, DEFAULT_REVIEWERS, loadConfig } from '../../factory/lib/config'
import { parseDiff, parsePatch } from '../../factory/lib/verify'
import type { CheckResult } from '../../factory/lib/checks'
import type { FactoryTask } from '../../factory/lib/tasks'

const task = (over: Partial<FactoryTask> = {}): FactoryTask => ({
  kind: 'fix-types', taskTier: 2, scoped: false, files: [], title: 't', objective: 'fix it', evidence: '', verify: ['typecheck'], ...over,
})
const patch = (file: string, removed: string[], added: string[]) =>
  [`diff --git a/${file} b/${file}`, `--- a/${file}`, `+++ b/${file}`, '@@ -1 +1 @@', ...removed.map(l => `-${l}`), ...added.map(l => `+${l}`)].join('\n')
const check = (name: CheckResult['name'], ok: boolean, output = ''): CheckResult => ({ name, ok, output, durationMs: 0, timedOut: false })

describe('parsePatch / parseDiff per-file lines', () => {
  it('splits added and removed lines per file and derives numstat', () => {
    const d = parsePatch(`${patch('a.ts', ['x'], ['y', 'z'])}\n${patch('b.ts', ['q'], [])}`)
    expect(d.files).toEqual([{ path: 'a.ts', added: 2, removed: 1, deleted: false }, { path: 'b.ts', added: 0, removed: 1, deleted: false }])
    expect(d.removedLinesByFile).toEqual({ 'a.ts': ['x'], 'b.ts': ['q'] })
    expect(d.addedLinesByFile).toEqual({ 'a.ts': ['y', 'z'] })
  })
  it('treats "---" after a hunk as content, not a header', () => {
    const d = parseDiff('0\t1\tREADME.md\n', 'diff --git a/README.md b/README.md\n--- a/README.md\n+++ b/README.md\n@@ -3 +2,0 @@\n--- old separator\n', new Set())
    expect(d.removedLinesByFile?.['README.md']).toEqual(['-- old separator'])
  })
  it('marks deleted files', () => {
    const d = parsePatch('diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-gone')
    expect(d.files[0]).toMatchObject({ path: 'x.ts', deleted: true, removed: 1 })
  })
})

describe('testIntegrity', () => {
  it('counts expect/assert/should/ava assertions', () => {
    expect(countAssertions(['expect(a).toBe(1); expect(b)', 'assert.equal(x, 1)', 'x.should.equal(1)', 't.is(a, b)', 'const expected = 1'])).toBe(5)
  })
  it('rejects losing assertions, snapshot edits and mocks of own modules', () => {
    expect(testIntegrity(parsePatch(patch('a.test.ts', ['expect(f()).toBe(1)'], ['f()'])))?.reason).toMatch(/removes 1 assertion/)
    expect(testIntegrity(parsePatch(patch('__snapshots__/a.test.ts.snap', ['x'], ['y'])))?.reason).toMatch(/snapshot/)
    expect(testIntegrity(parsePatch(patch('a.test.ts', [], ["jest.mock('../src/price')"])))?.reason).toMatch(/own code/)
    expect(testIntegrity(parsePatch(patch('a.test.ts', [], ["vi.mock('@/lib/db')"])))?.reason).toMatch(/own code/)
  })
  it('allows rewriting an assertion, adding assertions, and mocking third-party modules', () => {
    expect(testIntegrity(parsePatch(patch('a.test.ts', ['expect(f()).toBe(1)'], ['expect(f()).toBe(2)', 'expect(g()).toBe(3)'])))).toBeNull()
    expect(testIntegrity(parsePatch(patch('a.test.ts', [], ["vi.mock('node-fetch')"])))).toBeNull()
  })
})

describe('diffSanity', () => {
  it('rejects deleting source files and removing exports', () => {
    expect(diffSanity(task(), parsePatch('diff --git a/src/x.ts b/src/x.ts\n--- a/src/x.ts\n+++ /dev/null\n@@ -1 +0,0 @@\n-const a = 1'))?.reason).toMatch(/deletes source file/)
    expect(diffSanity(task(), parsePatch(patch('src/a.ts', ['export async function load(): Promise<void> {}'], [])))?.reason).toMatch(/removes exported load/)
  })
  it('allows changing an export in place', () => {
    expect(diffSanity(task(), parsePatch(patch('src/a.ts', ['export const n: string = 1'], ['export const n: number = 1'])))).toBeNull()
  })
  it('caps files beyond the ones the errors named', () => {
    const files = ['src/a.ts', 'src/b.ts', 'src/c.ts', 'src/d.ts', 'src/e.ts'].map(f => patch(f, ['x'], ['y'])).join('\n')
    expect(diffSanity(task({ files: ['src/a.ts'] }), parsePatch(files))?.reason).toMatch(/didn't name/)
    expect(diffSanity(task({ files: ['src/a.ts', 'src/b.ts'] }), parsePatch(files))).toBeNull()
  })
  it('rejects a mostly-reformatting model edit but judges formatter output only via the full diff', () => {
    const removed = Array.from({ length: 16 }, (_, i) => `const v${i} = "x";`)
    const added = Array.from({ length: 16 }, (_, i) => `const v${i} = 'x'`)
    const d = parsePatch(patch('src/a.ts', removed, added))
    expect(diffSanity(task(), d)?.reason).toMatch(/reformats 16/)
    // The repo's own fixer did the reformatting; the model's edit was one line.
    expect(diffSanity(task(), d, parsePatch(patch('src/a.ts', ['const n: string = 1'], ['const n: number = 1'])))).toBeNull()
  })
  it('helpers', () => {
    expect(exportedNames(['export default class Foo {', 'export type Bar = 1', 'export { x }'])).toEqual(['Foo', 'Bar'])
    expect(normalizeFormatting('  const a = "b";  ')).toBe("consta='b'")
  })
})

describe('typeEscapes', () => {
  it('rejects new any casts in source files for type/lint fixes only', () => {
    const d = parsePatch(patch('src/a.ts', ['const n: string = f()'], ['const n: string = f() as any']))
    expect(typeEscapes(task(), d)?.reason).toMatch(/casts to any in src\/a.ts/)
    expect(typeEscapes(task({ kind: 'fix-lint' }), parsePatch(patch('src/a.ts', [], ['function g(x: any) {}'])))?.reason).toMatch(/casts to any/)
    expect(typeEscapes(task({ kind: 'fix-tests' }), d)).toBeNull()
    expect(typeEscapes(task(), parsePatch(patch('src/a.test.ts', [], ['const m = vi.fn() as any'])))).toBeNull()
    // Pre-existing casts that move are not new.
    expect(typeEscapes(task(), parsePatch(patch('src/a.ts', ['  x as any'], ['    x as any'])))).toBeNull()
    expect(typeEscapes(task(), parsePatch(patch('src/a.ts', [], ['const company = anyone'])))).toBeNull()
  })
})

describe('importValidation', () => {
  it('extracts specifiers from import/require/dynamic import, skipping comments', () => {
    expect(importSpecifiers(["import a from 'a'", 'const b = require("b")', "await import('c')", "import 'd'", "// import x from 'nope'"])).toEqual(['a', 'b', 'c', 'd'])
    expect(packageOf('@scope/pkg/sub')).toBe('@scope/pkg')
    expect(packageOf('lodash/sumBy')).toBe('lodash')
  })
  it('resolves relative imports with TS/ESM conventions', () => {
    const files = new Set(['src/math.ts', 'src/util/index.tsx', 'src/data.json'])
    expect(resolveRelative('src/a.ts', './math.js', files)).toBe('src/math.ts')
    expect(resolveRelative('src/a.ts', './util', files)).toBe('src/util/index.tsx')
    expect(resolveRelative('src/a.ts', './data.json', files)).toBe('src/data.json')
    expect(resolveRelative('src/a.ts', './nope', files)).toBeNull()
  })
  it('rejects undeclared packages and missing files; accepts builtins, aliases, @types and moved imports', () => {
    const d = (lines: string[], removed: string[] = []) => parsePatch(patch('src/a.ts', removed, lines))
    expect(importValidation(d(["import x from 'left-pad'"]), ['react'])?.reason).toMatch(/undeclared package 'left-pad'/)
    expect(importValidation(d(["import { m } from './missing'"]), [], ['src/a.ts'])?.reason).toMatch(/doesn't exist/)
    expect(importValidation(d(["import fs from 'fs'", "import p from 'node:path'", "import { db } from '@/lib/db'", "import type { X } from 'express'"]), ['@types/express'], ['src/a.ts'])).toBeNull()
    expect(importValidation(d(["import x from 'left-pad'"], ["import x from 'left-pad'"]), [])).toBeNull()
    // Without a file list, relative imports aren't checked.
    expect(importValidation(d(["import { m } from './missing'"]), [])).toBeNull()
  })
  it('ignores non-code files', () => {
    expect(importValidation(parsePatch(patch('README.md', [], ["import x from 'whatever'"])), [])).toBeNull()
  })
})

describe('coverageDelta', () => {
  it('reads the Istanbul summary and rejects a real drop only', () => {
    expect(coveragePct('----\nAll files      |   84.21 |   70 |')).toBe(84.21)
    expect(coveragePct('no coverage here')).toBeNull()
    expect(coverageDelta([check('test', false, 'All files | 80 |')], [check('test', true, 'All files | 79.6 |')])).toBeNull()
    expect(coverageDelta([check('test', false, 'All files | 80 |')], [check('test', true, 'All files | 75 |')])?.reason).toMatch(/80% → 75%/)
    expect(coverageDelta([check('test', false, 'All files | 80 |')], [check('test', true, 'no summary')])).toBeNull()
  })
})

describe('adversarial reviewer', () => {
  const diffText = patch('src/price.ts', ['  const sum: string = prices.reduce((a, b) => a + b, 0)'], ['  const sum: number = prices.reduce((a, b) => a + b, 0) as any'])
  const cfg = loadConfig({} as NodeJS.ProcessEnv)

  it('always uses a different model family from the builder', () => {
    expect(reviewerModel('M0', cfg)).toBe('free-agent')
    expect(reviewerModel('M1', cfg)).toBe('local-qwen3')
    expect(DEFAULT_REVIEWERS.M0).not.toBe(cfg.models.M0)
    expect(DEFAULT_REVIEWERS.M1).not.toBe(cfg.models.M1)
  })
  it('asks the full checklist and includes the diff', () => {
    const p = buildAdversaryPrompt(task(), diffText)
    for (const q of CHECKLIST) expect(p).toContain(q)
    expect(p).toContain('const sum: number')
    expect(buildAdversaryPrompt(task(), 'x'.repeat(30_000))).toContain('(diff truncated)')
  })
  it('keeps FAIL only with evidence quoted from the diff', () => {
    const ok = parseAdversaryReply('<think>hmm</think>{"verdict":"FAIL","issues":[{"question":9,"evidence":"prices.reduce((a, b) => a + b, 0) as any","why":"casts to any to dodge the type error"}]}', diffText)
    expect(ok).toMatchObject({ verdict: 'FAIL', dropped: 0 })
    expect(ok?.issues[0].why).toMatch(/any/)
    // Real free-agent replies quote with the diff's +/- markers, sometimes across lines.
    const multi = parseAdversaryReply('{"verdict":"FAIL","issues":[{"question":9,"evidence":"-  const sum: string = prices.reduce((a, b) => a + b, 0)\\n+  const sum: number = prices.reduce((a, b) => a + b, 0) as any","why":"cast"}]}', diffText)
    expect(multi).toMatchObject({ verdict: 'FAIL', dropped: 0 })
    const invented = parseAdversaryReply('{"verdict":"FAIL","issues":[{"question":2,"evidence":"deleteAllUsers()","why":"made up"}]}', diffText)
    expect(invented).toMatchObject({ verdict: 'UNCERTAIN', issues: [], dropped: 1 })
  })
  it('returns null for malformed replies (no signal, never a block)', () => {
    expect(parseAdversaryReply('I think it is fine', diffText)).toBeNull()
    expect(parseAdversaryReply('{"verdict":"MAYBE"}', diffText)).toBeNull()
    expect(parseAdversaryReply('{"verdict":', diffText)).toBeNull()
  })
  it('maps results to actions by the veto stage', () => {
    const fail = { model: 'm', verdict: 'FAIL' as const, issues: [], dropped: 0, durationMs: 1 }
    expect(adversaryAction(null, 'pr')).toBe('none')
    expect(adversaryAction({ ...fail, verdict: 'PASS' }, 'pr')).toBe('none')
    expect(adversaryAction(fail, 'report')).toBe('label')
    expect(adversaryAction(fail, 'pr')).toBe('reject')
    expect(adversaryAction({ ...fail, verdict: 'UNCERTAIN' }, 'pr')).toBe('label')
    expect(DEFAULT_CAPABILITIES['adversarial-veto']).toBe('report')
  })
  it('calls LiteLLM with the reviewer model and parses the answer', async () => {
    let sent: { url: string; body: { model: string; temperature: number } } | null = null
    const fetchImpl = (async (url: string, init: { body: string }) => {
      sent = { url, body: JSON.parse(init.body) }
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"verdict":"PASS","issues":[]}' } }] }), { status: 200 })
    }) as unknown as typeof fetch
    const r = await runAdversary(cfg, 'M0', task(), diffText, fetchImpl)
    expect(r).toMatchObject({ model: 'free-agent', verdict: 'PASS' })
    expect(sent!.url).toBe(`${cfg.litellm.url}/v1/chat/completions`)
    expect(sent!.body).toMatchObject({ model: 'free-agent', temperature: 0 })
  })
  it('never throws: HTTP errors, network errors and disabled config give null', async () => {
    const down = (async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch
    const rateLimited = (async () => new Response('{}', { status: 429 })) as unknown as typeof fetch
    expect(await runAdversary(cfg, 'M0', task(), diffText, down)).toBeNull()
    expect(await runAdversary(cfg, 'M0', task(), diffText, rateLimited)).toBeNull()
    const off = { ...cfg, judge: { adversarial: { ...cfg.judge.adversarial, enabled: false } } }
    expect(await runAdversary(off, 'M0', task(), diffText, rateLimited)).toBeNull()
  })
  it('renders a PR body section only when there is a result', () => {
    expect(adversarySection(null)).toEqual([])
    expect(adversarySection({ model: 'local-qwen3', verdict: 'UNCERTAIN', issues: [], dropped: 2, durationMs: 1 }).join('\n')).toMatch(/UNCERTAIN.*2 unsupported/)
  })
})

describe('judge fixtures', () => {
  const rec: JudgeInputRecord = {
    attemptId: 'a1', repo: 'o/r', task: task(), baseline: [trimCheck(check('typecheck', false, 'x'.repeat(10_000)))], after: [],
    patch: patch('a.ts', ['a'], ['b']), verdict: { ok: true, reason: 'pass' },
  }
  it('trims check output and drops the attempt id and actual verdict', () => {
    expect(rec.baseline[0].output!.length).toBe(4_000)
    const f = fixtureFromRecord(rec, { name: 'n', source: 'PR closed', expect: 'reject', reason: 'x' })
    expect(f).toMatchObject({ name: 'n', expect: 'reject', reason: 'x', repo: 'o/r' })
    expect(f).not.toHaveProperty('attemptId')
    expect(f).not.toHaveProperty('verdict')
  })
  it('validates required fields', () => {
    expect(() => loadFixture('{"name":"x"}')).toThrow(/missing source/)
    expect(() => loadFixture(JSON.stringify({ name: 'x', source: 's', expect: 'maybe', task: {}, patch: '' }))).toThrow(/accept\|reject/)
  })
})

describe('capabilities (promotion ladder)', () => {
  it('defaults: proven task kinds open PRs, new capabilities start at report', () => {
    const c = loadConfig({} as NodeJS.ProcessEnv).capabilities
    expect(c['fix-types']).toBe('pr')
    expect(c['red-ci']).toBe('report')
    expect(c['security-alerts']).toBe('report')
  })
})
