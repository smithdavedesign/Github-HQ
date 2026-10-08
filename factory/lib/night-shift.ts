import { computeFactoryKpis, factoryNight, type FactoryKpis, type JobRecord } from '../../src/lib/agents/factory-kpis'
import type { FactoryConfig } from './config'
import { toJobRecords, type AttemptEntry, type LedgerEntry } from './ledger'

/**
 * Night Shift v2 (roadmap Phase 80, docs/autonomous-factory.md §14). Scheduled cycles run
 * 20:00–06:00 on AC power, sandboxed, at $0, ≤ maxPrsPerDay, human merge, PAUSE-able. Before the
 * night shift counts as "on", the sandbox has to prove itself for 7 consecutive nights with no
 * host-side repo code; success is then a rising yield and acceptance, not PR count.
 *
 * 30-day experiment (2026-10-07): clean nights prove the sandbox, not that the PRs are worth
 * having, so the gate also needs a quality bar over the last 30 days: enough resolved PRs, at
 * least half accepted, and the rated ones useful on average (value labels, pr-value.ts).
 */

export const CLEAN_NIGHTS_REQUIRED = 7
export const QUALITY_GATE = { windowDays: 30, minResolved: 5, minAcceptance: 0.5, minRated: 3, minAvgValue: 2 } as const

export interface QualityGate {
  resolved: number
  acceptance: number | null
  rated: number
  avgValue: number | null
  met: boolean
  /** What's still missing, in plain words; empty when met. */
  missing: string[]
}

export interface Readiness {
  /** Consecutive most-recent nights where every attempt ran sandboxed. */
  cleanNights: number
  required: number
  /** The sandbox half of the gate. */
  sandboxReady: boolean
  /** The quality half of the gate (30-day experiment). */
  quality: QualityGate
  /** Both halves. */
  ready: boolean
  /** Most recent night with a host-side attempt, if any. */
  lastHostNight: string | null
}

/**
 * Walk back from the latest night with attempts: a night counts when it had ≥ 1 attempt and every
 * attempt ran in the Docker sandbox. The first night with a host attempt ends the streak (attempts
 * from before isolation was recorded count as host).
 */
export function nightShiftReadiness(entries: LedgerEntry[], dayStartHour = 7, now = new Date()): Readiness {
  const byNight = new Map<string, AttemptEntry[]>()
  for (const a of entries.filter((e): e is AttemptEntry => e.type === 'attempt' && e.outcome !== 'rate_limited')) {
    const n = factoryNight(new Date(a.at), dayStartHour)
    byNight.set(n, [...(byNight.get(n) ?? []), a])
  }
  let cleanNights = 0
  let lastHostNight: string | null = null
  for (const night of [...byNight.keys()].sort().reverse()) {
    if (byNight.get(night)!.every(a => a.isolation === 'docker')) { cleanNights++; continue }
    lastHostNight = night
    break
  }
  const sandboxReady = cleanNights >= CLEAN_NIGHTS_REQUIRED
  const quality = qualityGate(entries, now, dayStartHour)
  return { cleanNights, required: CLEAN_NIGHTS_REQUIRED, sandboxReady, quality, ready: sandboxReady && quality.met, lastHostNight }
}

export function qualityGate(entries: LedgerEntry[], now: Date, dayStartHour = 7): QualityGate {
  const g = QUALITY_GATE
  const k = computeFactoryKpis(toJobRecords(entries), now, { windowDays: g.windowDays, dayStartHour })
  const resolved = k.merged + k.closed
  const missing: string[] = []
  if (resolved < g.minResolved) missing.push(`${g.minResolved - resolved} more merged or closed PR(s)`)
  else if ((k.acceptance ?? 0) < g.minAcceptance) missing.push(`acceptance ${Math.round((k.acceptance ?? 0) * 100)}% < ${g.minAcceptance * 100}%`)
  if (k.ratedPrs < g.minRated) missing.push(`${g.minRated - k.ratedPrs} more rated PR(s) (value:N label)`)
  else if ((k.avgValue ?? 0) < g.minAvgValue) missing.push(`average value ${(k.avgValue ?? 0).toFixed(1)} < ${g.minAvgValue}`)
  return { resolved, acceptance: k.acceptance, rated: k.ratedPrs, avgValue: k.avgValue, met: missing.length === 0, missing }
}

export interface ScheduledPolicy {
  /** null = run; otherwise why a scheduled cycle must not run. */
  refuse: string | null
  /** The config a scheduled cycle runs with (paid tier always off). */
  cfg: FactoryConfig
  notes: string[]
}

/** What a launchd (scheduled) cycle may do, whatever the config says for manual runs. */
export function scheduledPolicy(cfg: FactoryConfig): ScheduledPolicy {
  const notes: string[] = []
  if (cfg.sandbox.mode !== 'docker') {
    return { refuse: 'scheduled cycles only run sandboxed (sandbox.mode is "off"); repo code never runs on the host unattended', cfg, notes }
  }
  let out = cfg
  if (cfg.monthlyBudgetUsd > 0) {
    out = { ...cfg, monthlyBudgetUsd: 0 }
    notes.push(`night shift runs at $0: paid budget ($${cfg.monthlyBudgetUsd}) applies to manual runs only`)
  }
  return { refuse: null, cfg: out, notes }
}

export interface Trend {
  recent: FactoryKpis
  previous: FactoryKpis
  /** Yield and acceptance both up (rising), either down (falling), else flat; null without both halves. */
  direction: 'rising' | 'flat' | 'falling' | null
}

/** Last `half` nights vs the `half` before them (Phase 80's success measure over 30 nights). */
export function kpiTrend(jobs: JobRecord[], now: Date, half = 15): Trend {
  const cut = new Date(now.getTime() - half * 86_400_000)
  const recent = computeFactoryKpis(jobs, now, { windowDays: half })
  const previous = computeFactoryKpis(jobs.filter(j => j.startedAt < cut), cut, { windowDays: half })
  const dy = recent.overnightYield !== null && previous.overnightYield !== null ? recent.overnightYield - previous.overnightYield : null
  const da = recent.acceptance !== null && previous.acceptance !== null ? recent.acceptance - previous.acceptance : null
  const direction = dy === null || da === null ? null : dy > 0 && da >= 0 ? 'rising' : dy < 0 || da < 0 ? 'falling' : 'flat'
  return { recent, previous, direction }
}

export function readinessLine(r: Readiness): string {
  const sandbox = `${r.cleanNights}/${r.required} consecutive nights fully sandboxed${!r.sandboxReady && r.lastHostNight ? ` (last host-side run: night of ${r.lastHostNight})` : ''}`
  const q = r.quality
  const quality = q.met
    ? `quality met (${Math.round((q.acceptance ?? 0) * 100)}% accepted, value ${q.avgValue?.toFixed(1)}/5)`
    : `quality: ${q.missing.join(', ')}`
  return r.ready
    ? `Night shift v2: ready — ${sandbox}; ${quality}.`
    : `Night shift v2 gate: ${sandbox}; ${quality}.`
}
