import type { Capability, CapabilityStage } from './config'
import type { AttemptEntry, LedgerEntry, ResolutionEntry, ScanEntry } from './ledger'
import { ADVISOR_MIN_JUDGED, advisorReady, scoreAdvice } from './tier-advisor'

/**
 * Promotion ladder (roadmap Phase 75): observe → report → pr. The factory never promotes
 * itself; it shows the evidence and says when a capability has earned the next stage (or
 * should drop back). The owner edits `capabilities` in factory/factory.config.json.
 */

export const LADDER_WINDOW_DAYS = 30
/** observe → report: the sensor has found real work this many times. */
export const OBSERVE_MIN_SIGHTINGS = 3
/** report → pr: this many verified results at ≥ this rate. */
export const REPORT_MIN_VERIFIED = 5
export const REPORT_MIN_RATE = 0.8
/** pr → report (demotion hint): merge rate below this over at least this many resolved PRs. */
export const PR_MIN_MERGE_RATE = 0.5
export const PR_MIN_RESOLVED = 4
/** adversarial-veto: its FAIL/UNCERTAIN calls must match PRs you closed this often. */
export const VETO_MIN_PRECISION = 0.8
export const VETO_MIN_FLAGGED = 5

export interface CapabilityStatus {
  capability: Capability
  stage: CapabilityStage
  evidence: string
  /** What the evidence says to do next. */
  advice: 'promote' | 'demote' | 'hold'
  next: string
}

const pct = (n: number) => `${Math.round(n * 100)}%`

export function capabilityStatus(
  capability: Capability, stage: CapabilityStage, entries: LedgerEntry[], now: Date,
): CapabilityStatus {
  const since = now.getTime() - LADDER_WINDOW_DAYS * 86_400_000
  const recent = (iso: string) => new Date(iso).getTime() >= since
  const resolutions = new Map(entries.filter((e): e is ResolutionEntry => e.type === 'resolution').map(r => [r.attemptId, r.outcome]))
  const attempts = entries.filter((e): e is AttemptEntry => e.type === 'attempt' && !e.voided && e.outcome !== 'rate_limited' && recent(e.at))

  if (capability === 'adversarial-veto') {
    const flagged = attempts.filter(a => a.adversary && a.adversary.verdict !== 'PASS' && resolutions.has(a.id))
    const right = flagged.filter(a => resolutions.get(a.id) === 'rejected').length
    const precision = flagged.length ? right / flagged.length : 0
    const evidence = `${flagged.length} flagged PR(s) resolved; ${right} of them you closed (${pct(precision)} precision)`
    if (stage !== 'pr' && flagged.length >= VETO_MIN_FLAGGED && precision >= VETO_MIN_PRECISION) {
      return { capability, stage, evidence, advice: 'promote', next: 'its concerns match your reviews: set "adversarial-veto": "pr" to let a FAIL reject before a PR opens' }
    }
    if (stage === 'pr' && flagged.length >= VETO_MIN_FLAGGED && precision < VETO_MIN_PRECISION) {
      return { capability, stage, evidence, advice: 'demote', next: `its vetoes are often wrong (${pct(precision)}): set it back to "report"` }
    }
    return { capability, stage, evidence, advice: 'hold', next: stage === 'pr' ? 'vetoing' : `needs ${VETO_MIN_FLAGGED} resolved flagged PRs at ≥ ${pct(VETO_MIN_PRECISION)} precision to veto` }
  }

  if (capability === 'tier-advisor') {
    const s = scoreAdvice(entries.filter(e => e.type !== 'tier_advice' || recent((e as { at: string }).at)))
    const evidence = s.judged ? `${s.judged} rated tasks judged: ${s.exact} exact, ${s.tooHigh} too high, ${s.tooLow} too low` : 'no rated task has a verified fix yet'
    const ready = advisorReady(s)
    if (stage !== 'pr' && ready === 'promote') return { capability, stage, evidence, advice: 'promote', next: 'its ratings match outcomes: set "tier-advisor": "pr" to start each task at the advised tier' }
    if (stage === 'pr' && ready === 'demote') return { capability, stage, evidence, advice: 'demote', next: 'it often rates too low: set it back to "report"' }
    return { capability, stage, evidence, advice: 'hold', next: stage === 'pr' ? 'routing starts at the advised tier' : `needs ${ADVISOR_MIN_JUDGED} judged ratings, ≥ 80% exact or too high and ≥ 50% exact` }
  }

  if (capability === 'security-alerts') {
    // A sensor only: fixes go through deps-audit, so this never opens PRs itself.
    const latest = new Map<string, LedgerEntry>()
    for (const e of entries) if (e.type === 'signals' && (!latest.get(e.repo) || e.at > (latest.get(e.repo) as { at: string }).at)) latest.set(e.repo, e)
    const sig = [...latest.values()].filter((e): e is Extract<LedgerEntry, { type: 'signals' }> => e.type === 'signals')
    const off = sig.filter(s => s.alerts.status === 'disabled').length
    const evidence = sig.length ? `${sig.length - off}/${sig.length} repos report Dependabot alerts` : 'not sensed yet'
    return { capability, stage, evidence, advice: 'hold', next: off ? 'enable Dependabot alerts on the remaining repos; fixes go through deps-audit' : 'fixes go through deps-audit' }
  }

  const mine = attempts.filter(a => a.kind === capability)
  const sightings = entries.filter((e): e is ScanEntry => e.type === 'scan' && recent(e.at) && e.tasks.includes(capability)).length

  if (stage === 'observe') {
    const evidence = `seen ${sightings} time(s) in scans`
    return sightings >= OBSERVE_MIN_SIGHTINGS
      ? { capability, stage, evidence, advice: 'promote', next: `real work keeps showing up: set "${capability}": "report" to try it without PRs` }
      : { capability, stage, evidence, advice: 'hold', next: `needs ${OBSERVE_MIN_SIGHTINGS} sightings` }
  }

  const verified = mine.filter(a => a.outcome === 'verified')
  const rate = mine.length ? verified.length / mine.length : 0
  if (stage === 'report') {
    const evidence = `${verified.length}/${mine.length} verified (${pct(rate)}), no PRs opened`
    return verified.length >= REPORT_MIN_VERIFIED && rate >= REPORT_MIN_RATE
      ? { capability, stage, evidence, advice: 'promote', next: capability === 'red-ci' ? 'read its investigations; if they hold up, set "red-ci": "pr" to let it attempt fixes (oracle: the workflow passes on the PR)' : `set "${capability}": "pr" to let it open draft PRs` }
      : { capability, stage, evidence, advice: 'hold', next: `needs ${REPORT_MIN_VERIFIED} verified at ≥ ${pct(REPORT_MIN_RATE)}` }
  }

  const merged = mine.filter(a => resolutions.get(a.id) === 'merged').length
  const closed = mine.filter(a => resolutions.get(a.id) === 'rejected').length
  const mergeRate = merged + closed ? merged / (merged + closed) : 0
  const evidence = `${verified.length}/${mine.length} verified · ${merged} merged, ${closed} closed`
  return merged + closed >= PR_MIN_RESOLVED && mergeRate < PR_MIN_MERGE_RATE
    ? { capability, stage, evidence, advice: 'demote', next: `you close most of its PRs (${pct(mergeRate)} merged): consider "${capability}": "report"` }
    : { capability, stage, evidence, advice: 'hold', next: merged + closed ? `${pct(mergeRate)} merged` : 'awaiting your first merges' }
}

export function ladderStatus(capabilities: Record<Capability, CapabilityStage>, entries: LedgerEntry[], now: Date): CapabilityStatus[] {
  return (Object.keys(capabilities) as Capability[]).map(c => capabilityStatus(c, capabilities[c], entries, now))
}
