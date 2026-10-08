import { describe, expect, it } from 'vitest'
import { deadEnds, redCiInvestigated, type AttemptEntry, type LedgerEntry, type SignalsEntry } from '../../factory/lib/ledger'
import { parseDependabotAlerts, rankOpportunities } from '../../factory/lib/sensors'

const NOW = new Date('2026-10-08T15:00:00Z')
let n = 0
const att = (over: Partial<AttemptEntry>): AttemptEntry => ({
  type: 'attempt', id: `a${++n}`, runId: 'r', at: '2026-10-08T03:00:00Z', repo: 'o/r', kind: 'lint-autofix', taskTier: 1, tier: 'M0', model: 'npm',
  harness: 'lint-autofix', outcome: 'failed', reason: 'no changes made', exploring: false, durationMs: 1, costUsd: 0, inputTokens: 0, outputTokens: 0, ...over,
})

describe('dead ends count failures since the last success', () => {
  it('a fixer that worked once and now has nothing to fix stops retrying', () => {
    const entries = [
      att({ outcome: 'verified', reason: '11 file(s) rewritten', at: '2026-10-07T03:00:00Z' }),
      att({ at: '2026-10-07T05:00:00Z' }), att({ at: '2026-10-07T06:00:00Z' }),
    ]
    expect([...deadEnds(entries, NOW)]).toEqual(['o/r:lint-autofix'])
  })
  it('one failure after a success is not yet a dead end; a new success clears it', () => {
    expect(deadEnds([att({ outcome: 'verified', at: '2026-10-07T03:00:00Z' }), att({ at: '2026-10-07T05:00:00Z' })], NOW).size).toBe(0)
    expect(deadEnds([att({ at: '2026-10-07T05:00:00Z' }), att({ at: '2026-10-07T06:00:00Z' }), att({ outcome: 'verified', at: '2026-10-08T01:00:00Z' })], NOW).size).toBe(0)
  })
})

describe('red CI is investigated once per failure', () => {
  const run = { workflow: 'CI Pipeline', runId: 1, url: 'u', headSha: 's', at: '2026-10-07T10:00:00Z', conclusion: 'failure' }
  const investigation = (over: Partial<AttemptEntry> = {}) => att({
    kind: 'red-ci', tier: 'M1', harness: 'claude-code', outcome: 'verified', findings: '# Root cause\nlint errors', ciWorkflow: 'CI Pipeline', at: '2026-10-07T12:00:00Z', ...over,
  })
  it('a reported investigation newer than the failing run counts; older, failed or rate-limited ones do not', () => {
    expect(redCiInvestigated([investigation()], 'o/r', run)).toBe(true)
    expect(redCiInvestigated([investigation({ at: '2026-10-07T09:00:00Z' })], 'o/r', run)).toBe(false)
    expect(redCiInvestigated([investigation({ outcome: 'rate_limited', findings: undefined })], 'o/r', run)).toBe(false)
    expect(redCiInvestigated([investigation({ ciWorkflow: 'Deploy' })], 'o/r', run)).toBe(false)
  })
  it('at stage report, an investigated red CI no longer outranks repos with work left', () => {
    const signals = (repo: string, redCi: typeof run[] | null, critical = 0): SignalsEntry => ({
      type: 'signals', runId: 'r', at: NOW.toISOString(), repo, base: 'main', redCi,
      alerts: { status: 'ok', critical, high: 0, medium: 0, low: 0, npmFixable: critical }, botPrs: { open: 0, stale: [] },
    } as SignalsEntry)
    const sig = [signals('o/r', [run]), signals('o/deps', null, 3)]
    const entries: LedgerEntry[] = [investigation()]
    expect(rankOpportunities(['o/r', 'o/deps'], entries, sig, NOW)[0].repo).toBe('o/r')
    expect(rankOpportunities(['o/r', 'o/deps'], entries, sig, NOW, { redCiReportOnly: true })[0].repo).toBe('o/deps')
  })
})

describe('Dependabot alerts read every page', () => {
  it('flattens `gh api --paginate --slurp` pages and still accepts a single page', () => {
    const alert = (severity: string) => ({ security_vulnerability: { severity, package: { ecosystem: 'npm' }, first_patched_version: { identifier: '1.0.1' } } })
    const slurped = JSON.stringify([[alert('high'), alert('critical')], [alert('high')]])
    expect(parseDependabotAlerts(0, slurped)).toMatchObject({ status: 'ok', critical: 1, high: 2, npmFixable: 3 })
    expect(parseDependabotAlerts(0, JSON.stringify([alert('low')]))).toMatchObject({ low: 1 })
    expect(parseDependabotAlerts(0, '[]')).toMatchObject({ status: 'ok', critical: 0 })
  })
})

describe('red CI is parked while the free pool is exhausted', () => {
  it('drops out of the ranking so repos with model-free work get the slot', () => {
    const run = { workflow: 'CI', runId: 1, url: 'u', headSha: 's', at: '2026-10-07T10:00:00Z', conclusion: 'failure' }
    const sig = (repo: string, redCi: typeof run[] | null, critical = 0) => ({
      type: 'signals', runId: 'r', at: NOW.toISOString(), repo, base: 'main', redCi,
      alerts: { status: 'ok', critical, high: 0, medium: 0, low: 0, npmFixable: critical }, botPrs: { open: 0, stale: [] },
    }) as SignalsEntry
    const ranked = rankOpportunities(['o/red', 'o/deps'], [], [sig('o/red', [run]), sig('o/deps', null, 2)], NOW, { redCiReportOnly: true, redCiParked: 'no free capacity' })
    expect(ranked[0].repo).toBe('o/deps')
  })
})
