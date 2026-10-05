import { describe, it, expect } from 'vitest'
import {
  detectPackageManager, installCommand, planChecks, isPlaceholderTestScript,
  filesFromTscOutput, filesFromEslintOutput, errorExcerpt, readmeIssue, type CheckResult,
} from '../../factory/lib/checks'
import { tasksFromScan, filterTasks, buildPrompt, fitLocalContext, M0_MAX_BYTES } from '../../factory/lib/tasks'
import { judge, parseDiff, referencedScripts, referencedNpxTools, type DiffInfo } from '../../factory/lib/verify'
import {
  parseLedger, toAttemptRecords, monthToDateUsd, openPrAttempts, deadEnds, nextRepos, summarizeByTier,
  type AttemptEntry, type LedgerEntry,
} from '../../factory/lib/ledger'
import { selectCandidates, rankModels, pickAliases, isFreeToolModel, historicalOutcomes, type OpenRouterModel } from '../../factory/lib/scout-select'
import { parseFreeQuota } from '../../factory/lib/quota'
import { applyManagedBlocks, readManagedModels, renderFallbacksBlock } from '../../factory/lib/litellm-config'
import { parseClaudeResult, parseTokenCount, harnessFor } from '../../factory/lib/harness'
import { branchName, prBody, prTitle } from '../../factory/lib/pr'
import { attemptEventValues } from '../../factory/lib/sink'

const ok = (name: CheckResult['name'], pass = true, output = ''): CheckResult => ({ name, ok: pass, output, durationMs: 1, timedOut: false })

// ─── checks ──────────────────────────────────────────────────────────────────

describe('package manager + install', () => {
  it('detects from lockfiles', () => {
    expect(detectPackageManager(new Set(['pnpm-lock.yaml']))).toBe('pnpm')
    expect(detectPackageManager(new Set(['yarn.lock']))).toBe('yarn')
    expect(detectPackageManager(new Set(['bun.lock']))).toBe('bun')
    expect(detectPackageManager(new Set(['package-lock.json']))).toBe('npm')
  })
  it('uses npm ci only with a lockfile', () => {
    expect(installCommand('npm', new Set(['package-lock.json'])).args[0]).toBe('ci')
    expect(installCommand('npm', new Set()).args[0]).toBe('install')
  })
})

describe('planChecks', () => {
  it('uses the repo scripts', () => {
    const specs = planChecks({ scripts: { typecheck: 'tsc --noEmit', lint: 'eslint .', test: 'vitest run' } }, 'npm', true)
    expect(specs.map(s => s.display)).toEqual(['npm run typecheck', 'npm run lint', 'npm run test'])
  })
  it('falls back to tsc when there is a tsconfig and typescript but no script', () => {
    const specs = planChecks({ devDependencies: { typescript: '^5' } }, 'npm', true)
    expect(specs[0]).toMatchObject({ name: 'typecheck', display: 'npx tsc --noEmit' })
  })
  it('skips placeholder and watch-mode tests and next lint', () => {
    expect(planChecks({ scripts: { test: 'echo "Error: no test specified" && exit 1' } }, 'npm', false)).toEqual([])
    expect(planChecks({ scripts: { test: 'vitest' } }, 'npm', false)).toEqual([])
    expect(planChecks({ scripts: { lint: 'next lint' } }, 'npm', false)).toEqual([])
  })
  it('recognises placeholder test scripts', () => {
    expect(isPlaceholderTestScript(undefined)).toBe(true)
    expect(isPlaceholderTestScript('exit 0')).toBe(true)
    expect(isPlaceholderTestScript('node --test')).toBe(false)
  })
})

describe('output parsers', () => {
  it('extracts files from both tsc output styles', () => {
    const out = [
      "src/app.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'.",
      'src/lib/util.tsx:3:1 - error TS2304: Cannot find name foo.',
      "src/app.ts(14,1): error TS2322: again",
      'Found 3 errors.',
    ].join('\n')
    expect(filesFromTscOutput(out)).toEqual(['src/app.ts', 'src/lib/util.tsx'])
  })
  it('extracts files from eslint stylish output, relative to root', () => {
    const out = [
      '/repo/src/a.ts',
      "  3:10  error  'x' is defined but never used  no-unused-vars",
      '',
      'src/b.js',
      '  1:1  warning  Unexpected console statement  no-console',
      '',
      '✖ 2 problems (1 error, 1 warning)',
    ].join('\n')
    expect(filesFromEslintOutput(out, '/repo')).toEqual(['src/a.ts', 'src/b.js'])
  })
  it('errorExcerpt prefers error lines and caps size', () => {
    const out = ['noise', 'more noise', 'src/a.ts(1,1): error TS1: bad', 'trailing'].join('\n')
    expect(errorExcerpt(out)).toBe('src/a.ts(1,1): error TS1: bad')
    expect(errorExcerpt('x\n'.repeat(500), 10).split('\n')).toHaveLength(10)
  })
})

describe('readmeIssue', () => {
  const full = `# App\n\n${'Description. '.repeat(30)}\n\n## Installation\n\nnpm install\n\n## Usage\n\nnpm start\n`
  it('flags missing, tiny and section-less READMEs', () => {
    expect(readmeIssue(null)).toMatch(/missing/)
    expect(readmeIssue('# hi')).toMatch(/only/)
    expect(readmeIssue(`# App\n\n${'words '.repeat(80)}`)).toMatch(/installation .* or usage/)
  })
  it('accepts a README with install and usage sections', () => {
    expect(readmeIssue(full)).toBeNull()
  })
})

// ─── tasks ───────────────────────────────────────────────────────────────────

describe('tasksFromScan', () => {
  const specs = planChecks({ scripts: { typecheck: 'tsc', lint: 'eslint .', test: 'vitest run' } }, 'npm', true)
  it('orders type → lint → test → docs and marks scope', () => {
    const tasks = tasksFromScan(
      [ok('typecheck', false, 'src/a.ts(1,1): error TS2322: x'), ok('lint', false, 'src/b.ts\n  1:1  error  bad  rule'), ok('test', false, 'FAIL x')],
      specs, 'README.md is missing', '/repo',
    )
    expect(tasks.map(t => t.kind)).toEqual(['fix-types', 'fix-lint', 'fix-tests', 'docs-readme'])
    expect(tasks[0]).toMatchObject({ scoped: true, files: ['src/a.ts'], verify: ['typecheck'] })
    expect(tasks[2]).toMatchObject({ scoped: false, taskTier: 2 })
    expect(tasks[3]).toMatchObject({ taskTier: 1, files: ['README.md'] })
  })
  it('ignores timed-out checks and passing repos', () => {
    expect(tasksFromScan([{ ...ok('test', false), timedOut: true }], specs, null, '/r')).toEqual([])
    expect(tasksFromScan([ok('typecheck'), ok('lint'), ok('test')], specs, null, '/r')).toEqual([])
  })
  it('filterTasks drops open-PR and dead-end kinds', () => {
    const tasks = tasksFromScan([ok('typecheck', false, 'a.ts(1,1): error TS1: x'), ok('lint', false, '')], specs, null, '/r')
    expect(filterTasks(tasks, 'o/r', new Set(['o/r:fix-types']), new Set(['o/r:fix-lint']))).toEqual([])
  })
  it('buildPrompt trims evidence for M0 and asks M1 to run the checks', () => {
    const [t] = tasksFromScan([ok('typecheck', false, `a.ts(1,1): error TS1: ${'x'.repeat(5000)}`)], specs, null, '/r')
    expect(buildPrompt(t, 'M0', null, ['npm run typecheck']).length).toBeLessThan(4000)
    expect(buildPrompt(t, 'M1', null, ['npm run typecheck'])).toContain('run `npm run typecheck` to confirm')
    expect(buildPrompt(t, 'M1', null, [])).toContain('Never silence checks')
  })
  it('docs prompt lists only real scripts and the real repo URL', () => {
    const [t] = tasksFromScan([], [], 'README.md is missing', '/r')
    const p = buildPrompt(t, 'M1', { scripts: { dev: 'next dev', build: 'next build' } }, [], 'o/app')
    expect(p).toContain('dev, build')
    expect(p).toContain('https://github.com/o/app')
  })
})

// ─── verify ──────────────────────────────────────────────────────────────────

describe('judge', () => {
  const specs = planChecks({ scripts: { typecheck: 'tsc', test: 'vitest run' } }, 'npm', true)
  const [typeTask] = tasksFromScan([ok('typecheck', false, 'src/a.ts(1,1): error TS1: x')], specs, null, '/r')
  const baseline = [ok('typecheck', false), ok('test', true)]
  const diff = (files: [string, number, number, boolean?][], added: string[] = []): DiffInfo => ({
    files: files.map(([path, a, r, d]) => ({ path, added: a, removed: r, deleted: !!d })), addedLines: added,
  })

  it('accepts a scoped fix that passes with no regressions', () => {
    const v = judge({ task: typeTask, baseline, after: [ok('typecheck'), ok('test')], diff: diff([['src/a.ts', 2, 1]]) })
    expect(v.ok).toBe(true)
  })
  it('rejects empty diffs, forbidden paths and huge diffs', () => {
    expect(judge({ task: typeTask, baseline, after: baseline, diff: diff([]) }).reason).toMatch(/no changes/)
    expect(judge({ task: typeTask, baseline, after: baseline, diff: diff([['package-lock.json', 1, 1]]) }).reason).toMatch(/forbidden/)
    expect(judge({ task: typeTask, baseline, after: baseline, diff: diff([['.github/workflows/ci.yml', 1, 1]]) }).reason).toMatch(/forbidden/)
    expect(judge({ task: typeTask, baseline, after: baseline, diff: diff([['src/a.ts', 300, 200]]) }).reason).toMatch(/too large/)
  })
  it('rejects check-silencing changes', () => {
    for (const line of ['// @ts-ignore', '/* eslint-disable */', "it.skip('x', () => {})", "describe.only('x')", "xit('y')"]) {
      expect(judge({ task: typeTask, baseline, after: [ok('typecheck'), ok('test')], diff: diff([['src/a.ts', 1, 0]], [line]) }).ok).toBe(false)
    }
  })
  it('rejects scoped tasks that edit other files, and test edits on non-test tasks', () => {
    expect(judge({ task: typeTask, baseline, after: [ok('typecheck'), ok('test')], diff: diff([['src/a.ts', 1, 0], ['src/b.ts', 1, 0]]) }).reason).toMatch(/other files/)
    const unscoped = { ...typeTask, scoped: false, files: [] }
    expect(judge({ task: unscoped, baseline, after: [ok('typecheck'), ok('test')], diff: diff([['src/a.test.ts', 1, 0]]) }).reason).toMatch(/edited tests/)
  })
  it('rejects deleting test files', () => {
    const [testTask] = tasksFromScan([ok('test', false, 'FAIL')], specs, null, '/r')
    expect(judge({ task: testTask, baseline, after: [ok('typecheck'), ok('test')], diff: diff([['src/x.spec.ts', 0, 20, true]]) }).reason).toMatch(/deleted test/)
  })
  it('requires the target check to pass and nothing to regress', () => {
    expect(judge({ task: typeTask, baseline, after: [ok('typecheck', false), ok('test')], diff: diff([['src/a.ts', 1, 1]]) }).reason).toMatch(/still fails/)
    expect(judge({ task: typeTask, baseline, after: [ok('typecheck'), ok('test', false)], diff: diff([['src/a.ts', 1, 1]]) }).reason).toMatch(/regressed: test/)
  })
  it('README tasks: README only, must grow, no invented scripts', () => {
    const [docs] = tasksFromScan([], [], 'README.md is missing', '/r')
    const scripts = { dev: 'next dev', build: 'next build' }
    const good = '## Setup\n\n`npm install` then `npm run dev`, build with `npm run build`, test with `npm test`.'
    expect(judge({ task: docs, baseline: [], after: [], diff: diff([['README.md', 20, 2]]), scripts, readmeAfter: good }).ok).toBe(true)
    expect(judge({ task: docs, baseline: [], after: [], diff: diff([['README.md', 1, 5]]), scripts, readmeAfter: good }).reason).toMatch(/did not grow/)
    expect(judge({ task: docs, baseline: [], after: [], diff: diff([['README.md', 9, 0], ['src/a.ts', 1, 0]]), scripts, readmeAfter: good }).reason).toMatch(/non-README/)
    expect(judge({ task: docs, baseline: [], after: [], diff: diff([['README.md', 9, 0]]), scripts, readmeAfter: 'Run `npm run deploy:prod`' }).reason).toMatch(/deploy:prod/)
    expect(judge({ task: docs, baseline: [], after: [], diff: diff([['README.md', 9, 0]]), scripts, readmeAfter: 'git clone https://github.com/yourusername/app.git' }).reason).toMatch(/placeholder/)
  })
  it('parseDiff reads numstat and added lines', () => {
    const d = parseDiff('3\t1\tsrc/a.ts\n0\t9\told.test.ts\n', '+++ b/src/a.ts\n+const x = 1\n-const y = 2\n', new Set(['old.test.ts']))
    expect(d.files).toEqual([{ path: 'src/a.ts', added: 3, removed: 1, deleted: false }, { path: 'old.test.ts', added: 0, removed: 9, deleted: true }])
    expect(d.addedLines).toEqual(['const x = 1'])
    expect(d.removedLines).toEqual(['const y = 2'])
  })
})

// ─── ledger ──────────────────────────────────────────────────────────────────

const NOW = new Date('2026-10-05T12:00:00Z')
function att(p: Partial<AttemptEntry>): AttemptEntry {
  return {
    type: 'attempt', id: p.id ?? Math.random().toString(36).slice(2), runId: 'r', at: NOW.toISOString(), repo: 'o/r', kind: 'fix-lint',
    taskTier: 2, tier: 'M1', model: 'free-agent', harness: 'claude-code', outcome: 'verified', reason: '', exploring: false,
    durationMs: 1, costUsd: 0, inputTokens: 0, outputTokens: 0, ...p,
  }
}

describe('ledger', () => {
  it('parses JSONL and skips torn lines', () => {
    const text = `${JSON.stringify(att({ id: 'a' }))}\n{"type":"attem\n\n`
    expect(parseLedger(text)).toHaveLength(1)
  })
  it('router records: verified=success until rejected; rate limits ignored', () => {
    const entries: LedgerEntry[] = [
      att({ id: 'a' }), att({ id: 'b', prUrl: 'u' }), att({ id: 'c', outcome: 'failed' }), att({ id: 'd', outcome: 'rate_limited' }),
      { type: 'resolution', attemptId: 'b', at: NOW.toISOString(), outcome: 'rejected' },
    ]
    expect(toAttemptRecords(entries).map(r => r.outcome)).toEqual(['success', 'failed', 'failed'])
  })
  it('month-to-date spend only counts this month', () => {
    const entries = [att({ costUsd: 1.5, tier: 'M2' }), att({ costUsd: 4, tier: 'M2', at: '2026-09-30T23:00:00Z' })]
    expect(monthToDateUsd(entries, NOW)).toBe(1.5)
  })
  it('open PRs exclude resolved ones', () => {
    const entries: LedgerEntry[] = [att({ id: 'a', prUrl: 'u1' }), att({ id: 'b', prUrl: 'u2' }), { type: 'resolution', attemptId: 'a', at: '', outcome: 'merged' }]
    expect(openPrAttempts(entries).map(a => a.id)).toEqual(['b'])
  })
  it('dead ends: ≥2 recent failures with no success since the window', () => {
    const entries = [att({ outcome: 'failed' }), att({ outcome: 'failed' }), att({ kind: 'fix-types', outcome: 'failed' })]
    expect([...deadEnds(entries, NOW)]).toEqual(['o/r:fix-lint'])
    expect(deadEnds([...entries, att({ outcome: 'verified', at: NOW.toISOString() })], NOW).size).toBe(0)
    expect(deadEnds([att({ tier: 'M0', outcome: 'failed' }), att({ tier: 'M0', outcome: 'failed' })], NOW).size).toBe(0)
  })
  it('nextRepos puts never-scanned first, then least recent', () => {
    const entries: LedgerEntry[] = [
      { type: 'scan', runId: 'r', at: '2026-10-01T00:00:00Z', repo: 'o/a', checks: {}, tasks: [] },
      { type: 'scan', runId: 'r', at: '2026-10-03T00:00:00Z', repo: 'o/b', checks: {}, tasks: [] },
    ]
    expect(nextRepos(entries, ['o/b', 'o/a', 'o/c'])).toEqual(['o/c', 'o/a', 'o/b'])
  })
  it('summarizes per tier', () => {
    const entries: LedgerEntry[] = [att({ id: 'a', tier: 'M0' }), att({ id: 'b', tier: 'M2', costUsd: 0.4 }), { type: 'resolution', attemptId: 'a', at: '', outcome: 'merged' }]
    const s = summarizeByTier(entries)
    expect(s.find(r => r.tier === 'M0')).toMatchObject({ verified: 1, merged: 1 })
    expect(s.find(r => r.tier === 'M2')?.costUsd).toBe(0.4)
  })
})

// ─── scout ───────────────────────────────────────────────────────────────────

describe('scout selection', () => {
  const m = (id: string, ctx = 262_144, free = true, tools = true): OpenRouterModel => ({
    id, context_length: ctx, pricing: { prompt: free ? '0' : '0.1', completion: free ? '0' : '0.1' }, supported_parameters: tools ? ['tools'] : [],
  })
  it('keeps only free tool-calling models', () => {
    expect(isFreeToolModel(m('a'))).toBe(true)
    expect(isFreeToolModel(m('a', 1, false))).toBe(false)
    expect(isFreeToolModel(m('a', 1, true, false))).toBe(false)
  })
  it('excludes meta-routers, stealth and short-context models; keeps incumbents first', () => {
    const models = [m('openrouter/free'), m('stealth/x'), m('tiny/model', 8000), m('acme/coder-x'), m('acme/chat'), m('inc/best')]
    expect(selectCandidates(models, ['inc/best', 'gone/model'], 2)).toEqual(['inc/best', 'acme/coder-x'])
  })
  it('ranks by passes then speed and picks qualified aliases', () => {
    const scores = rankModels([
      { model: 'a', pass: true, durationMs: 50 }, { model: 'a', pass: true, durationMs: 50 }, { model: 'a', pass: false, durationMs: 50 },
      { model: 'b', pass: true, durationMs: 10 }, { model: 'b', pass: true, durationMs: 10 }, { model: 'b', pass: false, durationMs: 10 },
      { model: 'c', pass: false, durationMs: 1 }, { model: 'c', pass: false, durationMs: 1 }, { model: 'c', pass: true, durationMs: 1 },
    ])
    expect(scores.map(s => s.model)).toEqual(['b', 'a', 'c'])
    expect(pickAliases(scores, {})).toEqual({ primary: 'b', backup: 'a' })
  })
  it('keeps incumbents when nothing qualifies', () => {
    const scores = rankModels([{ model: 'x', pass: false, durationMs: 1 }])
    expect(pickAliases(scores, { primary: 'old', backup: 'older' })).toEqual({ primary: 'old', backup: 'older' })
  })
})

// ─── litellm config ──────────────────────────────────────────────────────────

describe('litellm managed blocks', () => {
  const base = [
    'model_list:', '  - model_name: local-coder', '    litellm_params:', '      model: ollama_chat/qwen', '',
    'litellm_settings:', '  drop_params: true', '', 'router_settings:', '  fallbacks:', '    - local-coder: ["cloud-or"]', '',
  ].join('\n')
  const models = [{ name: 'free-agent', model: 'q/q:free', kind: 'openrouter' as const }, { name: 'local-agent', model: 'qwen2.5:7b', kind: 'ollama' as const }]

  it('inserts both blocks without touching existing entries, and is idempotent', () => {
    const once = applyManagedBlocks(base, models, { 'free-agent': ['free-agent-b'] })
    expect(once).toContain('  - model_name: local-coder')
    expect(once).toContain('    - local-coder: ["cloud-or"]')
    expect(once).toContain('      model: openrouter/q/q:free')
    expect(once).toContain('      api_key: os.environ/OPENROUTER_API_KEY')
    expect(once.indexOf('free-agent')).toBeLessThan(once.indexOf('litellm_settings:'))
    expect(applyManagedBlocks(once, models, { 'free-agent': ['free-agent-b'] })).toBe(once)
    expect(readManagedModels(once)).toEqual({ 'free-agent': 'q/q:free', 'local-agent': 'qwen2.5:7b' })
  })
  it('replaces the managed block on update', () => {
    const once = applyManagedBlocks(base, models, {})
    const twice = applyManagedBlocks(once, [{ name: 'free-agent', model: 'new/m:free', kind: 'openrouter' }], {})
    expect(readManagedModels(twice)).toEqual({ 'free-agent': 'new/m:free' })
    expect(twice.match(/repohq-factory models/g)).toHaveLength(2)
  })
  it('renders free-only fallbacks and drops empty ones', () => {
    expect(renderFallbacksBlock({ a: ['b'], c: [] })).toContain('    - a: ["b"]')
    expect(renderFallbacksBlock({ c: [] })).not.toContain('- c')
  })
  it('throws when the config has no insertion point', () => {
    expect(() => applyManagedBlocks('nothing: here\n', models, {})).toThrow(/insertion point/)
  })
})

// ─── harness, pr, sink ───────────────────────────────────────────────────────

describe('harness helpers', () => {
  it('maps tiers to harnesses', () => {
    expect(harnessFor('M0')).toBe('aider')
    expect(harnessFor('M1')).toBe('claude-code')
    expect(harnessFor('M2')).toBe('claude-code')
  })
  it('parses the Claude Code JSON result out of mixed output', () => {
    const out = 'warning: unknown model\n{"type":"result","is_error":false,"result":"DONE","usage":{"input_tokens":10,"cache_read_input_tokens":90,"output_tokens":5}}\n'
    expect(parseClaudeResult(out)).toEqual({ isError: false, text: 'DONE', inputTokens: 100, outputTokens: 5 })
    expect(parseClaudeResult('no json here')).toBeNull()
  })
  it('parses Aider token counts', () => {
    expect(parseTokenCount('651')).toBe(651)
    expect(parseTokenCount('1.2k')).toBe(1200)
    expect(parseTokenCount('12,345')).toBe(12345)
  })
})

describe('pr + sink rendering', () => {
  const [task] = tasksFromScan([ok('lint', false, 'src/a.ts\n  1:1  error  x  rule')], planChecks({ scripts: { lint: 'eslint .' } }, 'npm', false), null, '/r')
  it('names branches and titles', () => {
    expect(branchName(task, NOW, 'run-abcd')).toBe('factory/fix-lint-20261005-abcd')
    expect(prTitle(task)).toMatch(/^\[factory\] Fix lint errors/)
  })
  it('PR body shows before/after checks and provenance', () => {
    const body = prBody({
      task, tier: 'M1', model: 'free-agent', harness: 'claude-code', verdict: 'lint passes',
      baseline: [ok('lint', false)], after: [ok('lint')], diff: { files: [{ path: 'src/a.ts', added: 1, removed: 1, deleted: false }], addedLines: [] },
      durationMs: 61_000, costUsd: 0, exploring: true,
    })
    expect(body).toContain('| lint | ❌ | ✅ |')
    expect(body).toContain('Tier **M1** (exploration run)')
    expect(body).toContain('$0.00')
  })
  it('sink maps attempts to agent_attempt events without PR events', () => {
    const v = attemptEventValues(att({ id: 'z', prUrl: 'https://github.com/o/r/pull/1' }), 'user-1', 7, 'Fix lint errors')
    expect(v).toMatchObject({ eventType: 'agent_attempt', dedupKey: 'factory:z', repoId: 7 })
    expect(v.metadata).toMatchObject({ outcome: 'success', source: 'factory', tier: 'M1' })
  })
})

describe('scout rotation', () => {
  const m = (id: string): OpenRouterModel => ({ id, context_length: 262_144, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'] })
  it('puts never-tested models first, then the least recently tested', () => {
    const models = [m('a/coder'), m('b/coder'), m('c/coder')]
    const last = { 'a/coder': '2026-10-01T00:00:00Z', 'b/coder': '2026-09-01T00:00:00Z' }
    expect(selectCandidates(models, [], 3, last)).toEqual(['c/coder', 'b/coder', 'a/coder'])
  })
})

describe('scout history + aliases', () => {
  it('demotes a displaced primary to backup', () => {
    const scores = rankModels([{ model: 'new', pass: true, durationMs: 1 }, { model: 'new', pass: true, durationMs: 1 }])
    expect(pickAliases(scores, { primary: 'old' })).toEqual({ primary: 'new', backup: 'old' })
  })
  it('needs at least two completed cases to qualify', () => {
    const scores = rankModels([{ model: 'lucky', pass: true, durationMs: 1 }])
    expect(pickAliases(scores, { primary: 'old' })).toEqual({ primary: 'old', backup: null })
  })
  it('history keeps recent outcomes for models still offered free', () => {
    const now = new Date('2026-10-05T00:00:00Z')
    const o = (model: string) => ({ model, case: 'seeded-bug', pass: true, durationMs: 1, rateLimited: false })
    const reports = [
      { at: '2026-10-01T00:00:00Z', outcomes: [o('a'), o('gone')] },
      { at: '2026-08-01T00:00:00Z', outcomes: [o('a')] },
    ]
    expect(historicalOutcomes(reports, new Set(['a']), now).map(h => h.model)).toEqual(['a'])
  })
})

describe('free quota', () => {
  it('parses the OpenRouter key endpoint', () => {
    expect(parseFreeQuota({ data: { free_model_daily_requests: { used: 79, limit: 50, remaining: 0 } } })).toEqual({ used: 79, limit: 50, remaining: 0 })
    expect(parseFreeQuota({ data: { free_model_daily_requests: { used: 10, limit: 50 } } })).toEqual({ used: 10, limit: 50, remaining: 40 })
    expect(parseFreeQuota({ data: {} })).toBeNull()
  })
})

describe('fitLocalContext', () => {
  const [docs] = tasksFromScan([], [], 'README.md is missing', '/r')
  it('keeps small scoped tasks on M0', () => {
    expect(fitLocalContext(docs, () => 2_000).scoped).toBe(true)
  })
  it('demotes tasks whose files exceed the local window', () => {
    expect(fitLocalContext(docs, () => M0_MAX_BYTES + 1).scoped).toBe(false)
  })
})

describe('referencedScripts', () => {
  it('ignores prose like "npm scripts" but catches commands', () => {
    const readme = 'Use the npm scripts below.\n\n```bash\nnpm install\nnpm run dev\npnpm lint\nyarn add x\n```\nThen `npm start`. Deploy with npm run deploy.'
    expect(referencedScripts(readme).sort()).toEqual(['deploy', 'dev', 'lint'])
  })
})

describe('README judge — additive only, real tools', () => {
  const [docs] = tasksFromScan([], [], 'README.md has no installation / setup section', '/r')
  const before = ['# App', '## Features', '- Trip management', '- Itinerary views', '- Budget tracker']
  const diffWith = (removed: string[], added: number): DiffInfo => ({
    files: [{ path: 'README.md', added, removed: removed.length, deleted: false }], addedLines: [], removedLines: removed,
  })
  it('rejects replacing existing sections', () => {
    const after = '# App\n## Usage\nnpm install\n' + 'step\n'.repeat(20)
    const v = judge({ task: docs, baseline: [], after: [], diff: diffWith(before.slice(1), 22), readmeAfter: after })
    expect(v.reason).toMatch(/deleted 4 existing lines/)
  })
  it('allows moving lines and adding sections', () => {
    const after = ['# App', '## Getting Started', '`npm install`', ...before.slice(1)].join('\n')
    const v = judge({ task: docs, baseline: [], after: [], diff: diffWith(['## Features'], 3), readmeAfter: after })
    expect(v.ok).toBe(true)
  })
  it('rejects npx tools that are not dependencies', () => {
    const after = [...before, '## Setup', '```bash', 'npx prisma migrate dev', '```'].join('\n')
    const v = judge({ task: docs, baseline: [], after: [], diff: diffWith([], 4), deps: ['next'], readmeAfter: after })
    expect(v.reason).toMatch(/npx prisma/)
    expect(judge({ task: docs, baseline: [], after: [], diff: diffWith([], 4), deps: ['prisma'], readmeAfter: after }).ok).toBe(true)
    const tscReadme = [...before, '`npx tsc --noEmit`'].join('\n')
    expect(judge({ task: docs, baseline: [], after: [], diff: diffWith([], 1), deps: ['typescript'], readmeAfter: tscReadme }).ok).toBe(true)
  })
  it('parses npx package names', () => {
    expect(referencedNpxTools('```\nnpx -y @scope/tool@1.2 run\nnpx create-next-app@latest\nnpx tsc --noEmit\n```').sort()).toEqual(['@scope/tool', 'create-next-app', 'tsc'])
  })
})
