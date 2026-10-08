import type { AttemptEntry, CiOracleEntry, LedgerEntry, ResolutionEntry, ScanEntry, SignalsEntry, ValueEntry } from './ledger'

/**
 * Automatic PR value (30-day experiment, Experiment B). The owner doesn't rate PRs by hand, so
 * each merged factory PR is scored from what it changed on main, using only what the factory
 * already records: its scans (checks, npm audit), its sensors (red CI, Dependabot) and the red-CI
 * oracle. Upkeep scores low by design. A `value:N` label still overrides the score.
 *
 *   3  material: critical advisories dropped, or red CI turned green
 *   2  useful: high advisories dropped, the check it fixed passes on main, or an owner request merged
 *   1  upkeep (README, lint autofix), or no evidence either way after OUTCOME_GIVE_UP_DAYS
 *   0  no effect: the check still fails on main, or the advisories didn't drop
 */

/** Wait this long after the merge so a scan or sensor reading of main exists. */
export const OUTCOME_WAIT_MS = 24 * 3_600_000
/** Without evidence by then, score the PR as upkeep instead of waiting forever. */
export const OUTCOME_GIVE_UP_DAYS = 14

export interface Outcome { value: number; evidence: string }

const CHECK_FOR_KIND: Record<string, string> = { 'fix-tests': 'test', 'fix-types': 'typecheck', 'fix-lint': 'lint' }

const isScan = (e: LedgerEntry): e is ScanEntry => e.type === 'scan'
const isSignals = (e: LedgerEntry): e is SignalsEntry => e.type === 'signals'
const latest = <T extends { at: string }>(xs: T[]): T | undefined => xs.reduce<T | undefined>((m, x) => (!m || x.at > m.at ? x : m), undefined)

/** The outcome score, or null while it's too early to tell. */
export function scoreOutcome(a: AttemptEntry, mergedAt: string, entries: LedgerEntry[], now: Date): Outcome | null {
  const merged = Date.parse(mergedAt)
  if (now.getTime() - merged < OUTCOME_WAIT_MS) return null
  const givenUp = now.getTime() - merged > OUTCOME_GIVE_UP_DAYS * 86_400_000
  const wait = (why: string): Outcome | null => (givenUp ? { value: 1, evidence: `no evidence after ${OUTCOME_GIVE_UP_DAYS} days (${why})` } : null)
  const scansAfter = entries.filter(isScan).filter(s => s.repo === a.repo && Date.parse(s.at) > merged)
  const signalsAfter = entries.filter(isSignals).filter(s => s.repo === a.repo && Date.parse(s.at) > merged)

  switch (a.kind) {
    case 'docs-readme': return { value: 1, evidence: 'README upkeep' }
    case 'lint-autofix': return { value: 1, evidence: 'lint autofix upkeep' }
    case 'owner-requested': return { value: 2, evidence: 'your request, merged' }

    case 'deps-audit': {
      const before = latest(entries.filter(isScan).filter(s => s.repo === a.repo && s.at <= a.at && s.audit))?.audit
      const after = latest(scansAfter.filter(s => s.audit))?.audit
      if (before && after) {
        if (after.critical < before.critical) return { value: 3, evidence: `critical advisories ${before.critical} → ${after.critical}` }
        if (after.high < before.high) return { value: 2, evidence: `high advisories ${before.high} → ${after.high}` }
        return { value: 0, evidence: `advisories unchanged (critical ${after.critical}, high ${after.high})` }
      }
      return wait('no npm audit of main since the merge')
    }

    case 'red-ci': {
      const oracle = entries.find((e): e is CiOracleEntry => e.type === 'ci_oracle' && e.attemptId === a.id)
      const sig = latest(signalsAfter.filter(s => s.redCi !== null))
      if (sig && a.ciWorkflow) {
        return sig.redCi!.some(r => r.workflow === a.ciWorkflow)
          ? { value: 0, evidence: `"${a.ciWorkflow}" still fails on main` }
          : { value: 3, evidence: `"${a.ciWorkflow}" is green on main` }
      }
      if (oracle) return oracle.passed ? { value: 3, evidence: `"${oracle.workflow}" passed on the PR` } : { value: 0, evidence: `"${oracle.workflow}" still failed on the PR` }
      return wait('no CI reading of main since the merge')
    }

    default: {
      const check = CHECK_FOR_KIND[a.kind]
      if (!check) return { value: 1, evidence: `${a.kind}, merged` }
      const result = latest(scansAfter.filter(s => s.checks[check] !== undefined && s.checks[check] !== null))?.checks[check]
      if (result === true) return { value: 2, evidence: `${check} passes on main` }
      if (result === false) return { value: 0, evidence: `${check} still fails on main` }
      return wait(`no ${check} run on main since the merge`)
    }
  }
}

/** Merged attempts that have no value yet (neither a label nor an outcome score). */
export function pendingOutcomes(entries: LedgerEntry[]): { attempt: AttemptEntry; mergedAt: string }[] {
  const valued = new Set(entries.filter((e): e is ValueEntry => e.type === 'value').map(v => v.attemptId))
  const merged = new Map(entries.filter((e): e is ResolutionEntry => e.type === 'resolution' && e.outcome === 'merged').map(r => [r.attemptId, r.at]))
  return entries
    .filter((e): e is AttemptEntry => e.type === 'attempt' && !!e.prUrl && merged.has(e.id) && !valued.has(e.id) && !e.voided)
    .map(attempt => ({ attempt, mergedAt: merged.get(attempt.id)! }))
}
