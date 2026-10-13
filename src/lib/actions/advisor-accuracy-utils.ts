/**
 * Pure (no-DB, no-auth) utilities for advisor accuracy computation.
 * Safe to import in unit tests and server actions alike.
 */

export type ImpactType = 'opportunity' | 'revenue' | 'security' | 'health'

/** Min data points before showing a success rate (rather than "building signal") */
export const MIN_DATA_POINTS: Record<ImpactType, number> = {
  security:    5,
  health:      3,
  opportunity: 3,
  revenue:     8,
}

/**
 * Extracts the first numeric value from a predictedDelta string.
 * "+14 opportunity points" → 14
 * "$200/mo MRR"           → 200
 * "+9 pts"                → 9
 */
export function parsePredictedDelta(str: string | null | undefined): number | null {
  if (!str) return null
  const match = str.match(/[+-]?\d+(?:\.\d+)?/)
  if (!match) return null
  return parseFloat(match[0])
}

/** Risk-adjusted suppress thresholds per impactType */
export const SUPPRESS_THRESHOLDS: Record<ImpactType, { maxFailureRate: number; minAttempts: number }> = {
  security:    { maxFailureRate: 0.70, minAttempts: 5 },
  revenue:     { maxFailureRate: 0.65, minAttempts: 5 },
  health:      { maxFailureRate: 0.60, minAttempts: 3 },
  opportunity: { maxFailureRate: 0.60, minAttempts: 3 },
}

/** One portfolio event as the accuracy computation needs it. */
export interface AccuracyEvent {
  eventType: string
  metadata: unknown
  occurredAt: Date
}

export interface AccuracyStat {
  impactType: ImpactType
  /** 0-100: measured merges whose health score went up (directional). */
  successRate: number
  /** Merges with a measured, high-confidence health delta: the rate's denominator. */
  dataPoints: number
  /** Average health points across those merges. */
  avgActualDelta: number
  /** Enough measured merges to trust the rate (MIN_DATA_POINTS). */
  hasSignal: boolean
  /** The same rate with the last 30 days weighted 2x. */
  timeDecayedRate: number
  /** Runs that failed before producing a PR. An execution problem, not a wrong recommendation. */
  executionFailures: number
}

type AccuracyMeta = { impactType?: string; deltaConfidence?: string; actualDelta?: number | null; actualDeltaPending?: boolean } | null

/**
 * Gives each event without an impactType the one its task was queued with (by taskId). Only the Advisor's
 * agent_task_queued event carries the type: the merge checker's agent_pr_merged and the factory's events
 * don't, so until 2026-10-13 no merged recommendation ever reached the accuracy table (all 4 merges were
 * measured, none was typed).
 */
export function withImpactTypes<T extends AccuracyEvent>(events: T[], queued: Pick<AccuracyEvent, 'metadata'>[]): T[] {
  const byTask = new Map<string, string>()
  for (const q of queued) {
    const m = q.metadata as { taskId?: string; impactType?: string | null } | null
    if (m?.taskId && m.impactType) byTask.set(m.taskId, m.impactType)
  }
  return events.map(e => {
    const m = (e.metadata ?? {}) as { taskId?: string; impactType?: string | null }
    const type = m.taskId ? byTask.get(m.taskId) : undefined
    return m.impactType || !type ? e : { ...e, metadata: { ...m, impactType: type } }
  })
}

/**
 * Advisor accuracy per impact type: did the health score go up after a merged recommendation?
 * Only merges with a measured, high-confidence delta count. A run that failed before opening a PR
 * says nothing about whether the advice was right, so it's reported as `executionFailures` instead
 * of counting as a miss. (Counting failures as misses made every type read 0% on 2026-10-11:
 * all 14 data points were failed Nexus-era executions, and the advisor's prompt was told its
 * revenue advice never works.)
 */
export function computeAccuracy(events: AccuracyEvent[], impactType: ImpactType, now = new Date()): AccuracyStat {
  const relevant = events.filter(e => (e.metadata as AccuracyMeta)?.impactType === impactType)
  const measured = relevant.filter(e => {
    const m = e.metadata as AccuracyMeta
    return e.eventType === 'agent_pr_merged' && m?.deltaConfidence !== 'low' && !m?.actualDeltaPending && m?.actualDelta != null
  })
  const delta = (e: AccuracyEvent) => (e.metadata as AccuracyMeta)?.actualDelta ?? 0
  const successes = measured.filter(e => delta(e) > 0)
  const recentCutoff = now.getTime() - 30 * 86_400_000
  const weight = (e: AccuracyEvent) => (e.occurredAt.getTime() >= recentCutoff ? 2 : 1)
  const weightedTotal = measured.reduce((n, e) => n + weight(e), 0)
  const weightedSuccesses = successes.reduce((n, e) => n + weight(e), 0)
  const dataPoints = measured.length
  return {
    impactType,
    successRate: dataPoints ? Math.round((successes.length / dataPoints) * 100) : 0,
    dataPoints,
    avgActualDelta: dataPoints ? Math.round(measured.reduce((n, e) => n + delta(e), 0) / dataPoints) : 0,
    hasSignal: dataPoints >= MIN_DATA_POINTS[impactType],
    timeDecayedRate: weightedTotal ? Math.round((weightedSuccesses / weightedTotal) * 100) : 0,
    executionFailures: relevant.filter(e => e.eventType === 'agent_execution_failed').length,
  }
}

export const IMPACT_TYPES: ImpactType[] = ['opportunity', 'revenue', 'security', 'health']
