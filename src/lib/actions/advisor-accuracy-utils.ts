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
