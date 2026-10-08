import { describe, expect, it } from 'vitest'
import { pendingOutcomes, scoreOutcome } from '../../factory/lib/outcomes'
import type { AttemptEntry, LedgerEntry, ScanEntry, SignalsEntry } from '../../factory/lib/ledger'

const MERGED = '2026-10-05T12:00:00Z'
const NOW = new Date('2026-10-08T12:00:00Z')
const att = (kind: string, over: Partial<AttemptEntry> = {}): AttemptEntry => ({
  type: 'attempt', id: `a-${kind}`, runId: 'r', at: '2026-10-05T03:00:00Z', repo: 'o/r', kind, taskTier: 1, tier: 'M1', model: 'm',
  harness: 'h', outcome: 'verified', reason: '', exploring: false, durationMs: 1, costUsd: 0, inputTokens: 0, outputTokens: 0, prUrl: 'u', ...over,
})
const scan = (at: string, over: Partial<ScanEntry> = {}): ScanEntry => ({ type: 'scan', runId: 'r', at, repo: 'o/r', checks: {}, tasks: [], ...over })
const signals = (at: string, redCi: SignalsEntry['redCi']): SignalsEntry => ({
  type: 'signals', runId: 'r', at, repo: 'o/r', base: 'main', redCi,
  alerts: { status: 'ok', critical: 0, high: 0, medium: 0, low: 0, npmFixable: 0 }, botPrs: null,
})

describe('PR outcome scoring', () => {
  it('waits a day after the merge', () => {
    expect(scoreOutcome(att('fix-tests'), MERGED, [], new Date('2026-10-05T20:00:00Z'))).toBeNull()
  })
  it('deps-audit: critical dropped = 3, high dropped = 2, unchanged = 0', () => {
    const before = scan('2026-10-05T02:00:00Z', { audit: { critical: 3, high: 9, moderate: 0, low: 0 } })
    const after = (critical: number, high: number) => scan('2026-10-06T02:00:00Z', { audit: { critical, high, moderate: 0, low: 0 } })
    expect(scoreOutcome(att('deps-audit'), MERGED, [before, after(0, 9)], NOW)).toEqual({ value: 3, evidence: 'critical advisories 3 → 0' })
    expect(scoreOutcome(att('deps-audit'), MERGED, [before, after(3, 4)], NOW)?.value).toBe(2)
    expect(scoreOutcome(att('deps-audit'), MERGED, [before, after(3, 9)], NOW)?.value).toBe(0)
  })
  it('fix-* kinds: 2 when the check passes on main after the merge, 0 when it still fails', () => {
    expect(scoreOutcome(att('fix-tests'), MERGED, [scan('2026-10-06T00:00:00Z', { checks: { test: true } })], NOW)).toEqual({ value: 2, evidence: 'test passes on main' })
    expect(scoreOutcome(att('fix-lint'), MERGED, [scan('2026-10-06T00:00:00Z', { checks: { lint: false } })], NOW)?.value).toBe(0)
    // A scan from before the merge isn't evidence.
    expect(scoreOutcome(att('fix-lint'), MERGED, [scan('2026-10-05T01:00:00Z', { checks: { lint: true } })], NOW)).toBeNull()
  })
  it('red-ci: 3 when the workflow is green on main, 0 when it still fails', () => {
    const red = { workflow: 'CI', runId: 1, url: 'u', headSha: 's', at: '2026-10-06T00:00:00Z', conclusion: 'failure' }
    expect(scoreOutcome(att('red-ci', { ciWorkflow: 'CI' }), MERGED, [signals('2026-10-06T01:00:00Z', [])], NOW)?.value).toBe(3)
    expect(scoreOutcome(att('red-ci', { ciWorkflow: 'CI' }), MERGED, [signals('2026-10-06T01:00:00Z', [red])], NOW)?.value).toBe(0)
  })
  it('upkeep scores 1, an owner request 2; no evidence after 14 days scores 1', () => {
    expect(scoreOutcome(att('docs-readme'), MERGED, [], NOW)?.value).toBe(1)
    expect(scoreOutcome(att('lint-autofix'), MERGED, [], NOW)?.value).toBe(1)
    expect(scoreOutcome(att('owner-requested'), MERGED, [], NOW)?.value).toBe(2)
    expect(scoreOutcome(att('fix-types'), MERGED, [], new Date('2026-10-25T00:00:00Z'))?.value).toBe(1)
  })
  it('pending: merged, not voided, and no value yet (a label or an earlier score)', () => {
    const a = att('fix-tests'), b = att('docs-readme'), c = att('fix-lint')
    const entries: LedgerEntry[] = [a, b, c,
      { type: 'resolution', attemptId: a.id, at: MERGED, outcome: 'merged' },
      { type: 'resolution', attemptId: b.id, at: MERGED, outcome: 'merged' },
      { type: 'resolution', attemptId: c.id, at: MERGED, outcome: 'rejected' },
      { type: 'value', attemptId: b.id, at: MERGED, value: 4, source: 'label' },
    ]
    expect(pendingOutcomes(entries).map(p => p.attempt.id)).toEqual([a.id])
  })
})
