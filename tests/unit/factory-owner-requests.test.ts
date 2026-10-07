/**
 * Front door — factory side (ai-stack/repohq/CONTRACT.md).
 * The OpenClaw side (enqueue/report) is tested separately in ai-stack/repohq/tests/.
 * Here: turning an owner request into a judged FactoryTask, deciding what's still pending,
 * and writing the terminal `owner_result` the front door reports back.
 */
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ownerRequestedTask, buildPrompt, PIPELINES } from '../../factory/lib/tasks'
import { judge, type DiffInfo } from '../../factory/lib/verify'
import { readLedger, appendEntry, type AttemptEntry, type LedgerEntry, type OwnerResultEntry } from '../../factory/lib/ledger'
import { DEFAULT_CAPABILITIES } from '../../factory/lib/config'
import {
  readOwnerRequests, pendingOwnerRequests, recordOwnerResult, recordOwnerBlocked, queuePath, staleBotPrBlock,
} from '../../factory/lib/owner-requests'
import { rankOpportunities } from '../../factory/lib/sensors'

const tmpHome = () => mkdtempSync(path.join(tmpdir(), 'factory-owner-'))
const writeQueue = (home: string, ...reqs: object[]) => {
  mkdirSync(path.dirname(queuePath(home)), { recursive: true })
  writeFileSync(queuePath(home), reqs.map(r => JSON.stringify(r)).join('\n') + '\n')
}
const req = (taskId: string, repo: string, task = 'do a thing') => ({ taskId, repo, task, source: 'openclaw', status: 'queued' })
const ownerResults = (home: string) =>
  readLedger(home).filter((e): e is OwnerResultEntry => e.type === 'owner_result')
const ok = (name: AttemptEntry['kind'], pass = true) => ({ name, ok: pass, output: '', durationMs: 1, timedOut: false }) as never
const diff = (files: { path: string; added?: number; removed?: number; deleted?: boolean }[]): DiffInfo => ({
  files: files.map(f => ({ path: f.path, added: f.added ?? 1, removed: f.removed ?? 0, deleted: f.deleted ?? false })),
  addedLines: [], addedLinesByFile: {}, removedLinesByFile: {},
})

// ─── ownerRequestedTask ────────────────────────────────────────────────────

describe('ownerRequestedTask', () => {
  it('is unscoped, free-form (no acceptance check of its own), and carries the taskId', () => {
    const t = ownerRequestedTask('owner/repo', '  fix the map crash  ', 'owner-123')
    expect(t.kind).toBe('owner-requested')
    expect(t.scoped).toBe(false)
    expect(t.files).toEqual([])
    expect(t.verify).toEqual([]) // the judge's generic gate is the whole safety story
    expect(t.ownerTaskId).toBe('owner-123')
    expect(t.objective).toContain('fix the map crash') // trimmed into the prompt
    expect(t.taskTier).toBe(2) // free-form needs a capable (cloud/free-pool) tier, not M0
  })

  it('truncates a long request into a readable PR title', () => {
    const t = ownerRequestedTask('o/r', 'x'.repeat(200), 'owner-1')
    expect(t.title.length).toBeLessThan(80)
    expect(t.title.endsWith('…')).toBe(true)
  })

  it('has a fixed pipeline entry and defaults to the conservative `report` stage', () => {
    expect(PIPELINES['owner-requested']).toMatch(/judge/)
    // New capability → starts held (dry run) like red-ci/security; the owner promotes it to `pr`.
    expect(DEFAULT_CAPABILITIES['owner-requested']).toBe('report')
  })

  it('builds a clean free-form prompt (no empty "Errors:" block) with the repo URL and rules', () => {
    const p = buildPrompt(ownerRequestedTask('o/r', 'add a dark mode toggle', 'owner-1'), 'M1', null, ['npm test'], 'o/r')
    expect(p).toContain('add a dark mode toggle')
    expect(p).toContain('https://github.com/o/r')
    expect(p).not.toContain('Errors:')
    expect(p).toMatch(/smallest change/i) // RULES carried in
    expect(p).toContain('npm test')
  })
})

// ─── the judge gate for a free-form owner change ─────────────────────────────

describe('judge() on an owner-requested diff (generic gate = the contract)', () => {
  const task = ownerRequestedTask('o/r', 'tweak the header', 'owner-1')
  const base = [ok('typecheck'), ok('test')]

  it('accepts a small change that keeps every check green', () => {
    const v = judge({ task, baseline: base, after: base, diff: diff([{ path: 'src/header.ts', added: 10 }]) })
    expect(v.ok).toBe(true)
  })

  it('rejects editing CI / lockfiles (forbidden paths)', () => {
    const v = judge({ task, baseline: base, after: base, diff: diff([{ path: '.github/workflows/ci.yml', added: 3 }]) })
    expect(v.ok).toBe(false)
    expect(v.reason).toMatch(/forbidden/)
  })

  it('rejects a diff over the size budget', () => {
    const v = judge({ task, baseline: base, after: base, diff: diff([{ path: 'src/a.ts', added: 500 }]) })
    expect(v.ok).toBe(false)
    expect(v.reason).toMatch(/too large/)
  })

  it('rejects a regression (a previously-passing check now fails)', () => {
    const after = [ok('typecheck'), ok('test', false)]
    const v = judge({ task, baseline: base, after, diff: diff([{ path: 'src/a.ts', added: 5 }]) })
    expect(v.ok).toBe(false)
    expect(v.reason).toMatch(/regressed/)
  })

  it('rejects deleting a test file', () => {
    const v = judge({ task, baseline: base, after: base, diff: diff([{ path: 'src/a.test.ts', deleted: true }]) })
    expect(v.ok).toBe(false)
    expect(v.reason).toMatch(/deleted test/)
  })
})

// ─── pending / resolved bookkeeping ──────────────────────────────────────────

describe('readOwnerRequests / pendingOwnerRequests', () => {
  it('reads valid rows and skips malformed ones', () => {
    const home = tmpHome()
    mkdirSync(path.dirname(queuePath(home)), { recursive: true })
    writeFileSync(queuePath(home), [JSON.stringify(req('owner-1', 'o/r')), '{bad json', JSON.stringify({ taskId: 'x' })].join('\n'))
    const all = readOwnerRequests(home)
    expect(all).toHaveLength(1) // the one with taskId+repo+task
    expect(all[0].taskId).toBe('owner-1')
  })

  it('returns nothing when the queue file is absent', () => {
    expect(readOwnerRequests(tmpHome())).toEqual([])
    expect(pendingOwnerRequests(tmpHome(), [])).toEqual([])
  })

  it('excludes requests that already have a terminal owner_result', () => {
    const home = tmpHome()
    writeQueue(home, req('owner-1', 'o/a'), req('owner-2', 'o/b'))
    appendEntry(home, { type: 'owner_result', runId: 'r', at: 't', repo: 'o/a', ownerTaskId: 'owner-1', ownerStatus: 'pr', prUrl: 'u' })
    const pending = pendingOwnerRequests(home, readLedger(home))
    expect(pending.map(p => p.taskId)).toEqual(['owner-2'])
  })

  it('takes only the oldest pending request per repo (one owner task per repo per cycle)', () => {
    const home = tmpHome()
    writeQueue(home, req('owner-1', 'o/r', 'first'), req('owner-2', 'o/r', 'second'))
    const pending = pendingOwnerRequests(home, readLedger(home))
    expect(pending).toHaveLength(1)
    expect(pending[0].taskId).toBe('owner-1')
  })
})

// ─── recordOwnerResult: ladder verdict → terminal entry ──────────────────────

describe('recordOwnerResult', () => {
  const attempt = (home: string, ownerTaskId: string, over: Partial<AttemptEntry>) =>
    appendEntry(home, {
      type: 'attempt', id: over.id ?? 'a1', runId: 'r', at: 't', repo: 'o/r', kind: 'owner-requested',
      taskTier: 2, tier: 'M1', model: 'm', harness: 'h', outcome: 'failed', reason: '', exploring: false,
      durationMs: 1, costUsd: 0, inputTokens: 0, outputTokens: 0, ownerTaskId, ...over,
    } as AttemptEntry)

  it("maps 'pr' to ownerStatus:pr and carries the PR url from the attempt", () => {
    const home = tmpHome()
    attempt(home, 'owner-1', { outcome: 'verified', prUrl: 'https://gh/pr/7' })
    const wrote = recordOwnerResult(home, { ownerTaskId: 'owner-1', repo: 'o/r', runId: 'r', result: 'pr', ledger: readLedger(home), now: new Date() })
    expect(wrote).toBe(true)
    const [res] = ownerResults(home)
    expect(res.ownerStatus).toBe('pr')
    expect(res.prUrl).toBe('https://gh/pr/7')
    expect(res.reason).toBeUndefined()
  })

  it("maps a judge rejection ('failed' result, no PR) to ownerStatus:rejected with the judge's reason", () => {
    const home = tmpHome()
    attempt(home, 'owner-1', { outcome: 'failed', reason: 'diff too large (500 lines > 400)' })
    recordOwnerResult(home, { ownerTaskId: 'owner-1', repo: 'o/r', runId: 'r', result: 'failed', ledger: readLedger(home), now: new Date() })
    const [res] = ownerResults(home)
    expect(res.ownerStatus).toBe('failed')
    expect(res.reason).toContain('diff too large')
  })

  it("maps a report-stage 'verified' result (held, no PR) to ownerStatus:verified with a promote hint", () => {
    const home = tmpHome()
    attempt(home, 'owner-1', { outcome: 'verified' }) // reported:true, no prUrl (stage `report`)
    recordOwnerResult(home, { ownerTaskId: 'owner-1', repo: 'o/r', runId: 'r', result: 'verified', ledger: readLedger(home), now: new Date() })
    const [res] = ownerResults(home)
    expect(res.ownerStatus).toBe('verified')
    expect(res.prUrl).toBeUndefined()
    expect(res.reason).toMatch(/promote/)
  })

  it("does not write (leaves the request pending) on 'deferred' — free quota retries next cycle", () => {
    const home = tmpHome()
    attempt(home, 'owner-1', { outcome: 'rate_limited' })
    const wrote = recordOwnerResult(home, { ownerTaskId: 'owner-1', repo: 'o/r', runId: 'r', result: 'deferred', ledger: readLedger(home), now: new Date() })
    expect(wrote).toBe(false)
    expect(ownerResults(home)).toEqual([])
  })

  it('recordOwnerBlocked writes a rejected result with the given reason', () => {
    const home = tmpHome()
    recordOwnerBlocked(home, { ownerTaskId: 'owner-1', repo: 'o/r', runId: 'r', reason: 'an owner-requested PR is already open', now: new Date() })
    const [res] = ownerResults(home)
    expect(res.ownerStatus).toBe('rejected')
    expect(res.reason).toContain('already open')
  })

  it('a recorded result makes the request no longer pending (loop closes)', () => {
    const home = tmpHome()
    writeQueue(home, req('owner-1', 'o/r'))
    attempt(home, 'owner-1', { outcome: 'verified', prUrl: 'u' })
    recordOwnerResult(home, { ownerTaskId: 'owner-1', repo: 'o/r', runId: 'r', result: 'pr', ledger: readLedger(home), now: new Date() })
    expect(pendingOwnerRequests(home, readLedger(home))).toEqual([])
  })
})

// ─── Stale bot PRs (blockOnStaleBotPrs) ────────────────────────────────────

describe('staleBotPrBlock', () => {
  const now = new Date('2026-10-07T10:00:00Z')
  // What run.ts passes in: the repo's `blocked` from the ranked queue.
  const blocked = rankOpportunities(['o/r'], [], [{
    type: 'signals', runId: 'r', at: now.toISOString(), repo: 'o/r', base: 'main', redCi: [],
    alerts: { status: 'ok', critical: 0, high: 0, medium: 0, low: 0, npmFixable: 0 },
    botPrs: { open: 2, stale: [{ number: 4, url: 'https://github.com/o/r/pull/4', ageDays: 40 }] },
  }], now, { blockOnStalePrs: true })[0].blocked

  it('rejects a fix request that would open a PR, saying what to do', () => {
    expect(blocked).toMatch(/1 stale bot PR/)
    expect(staleBotPrBlock({ mode: 'fix' }, blocked, true)).toMatch(/^no new factory PRs on this repo: 1 stale bot PR.* — review or close them, then retry the request$/)
    // JSONL (OpenClaw) requests carry no mode: they are fixes.
    expect(staleBotPrBlock({}, blocked, true)).not.toBeNull()
  })

  it('lets through what opens no PR: reports, fixes held at stage report or in a dry run', () => {
    expect(staleBotPrBlock({ mode: 'report' }, blocked, true)).toBeNull()
    expect(staleBotPrBlock({ mode: 'fix' }, blocked, false)).toBeNull()
  })

  it('a repo without stale bot PRs (or with the rule off) blocks nothing', () => {
    expect(staleBotPrBlock({ mode: 'fix' }, null, true)).toBeNull()
  })
})
