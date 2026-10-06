export type EffortLevel = 'low' | 'medium' | 'high'

export const EFFORT_META: Record<EffortLevel, { label: string; description: string; color: string }> = {
  low:    { label: 'Low',    description: '< 4 hours to meaningful progress', color: 'text-emerald-600' },
  medium: { label: 'Medium', description: '1-3 days of focused work',          color: 'text-amber-600'   },
  high:   { label: 'High',   description: 'Week+ of sustained effort',         color: 'text-red-600'     },
}

/** Opportunity at or above this is always "high", whatever the rest of the portfolio scores. */
export const ABSOLUTE_HIGH_OPPORTUNITY = 50
const MIN_HIGH_OPPORTUNITY = 10

/**
 * "High opportunity" relative to the portfolio: the top quarter of scores (75th percentile),
 * floored at 10 so a portfolio of near-zeros doesn't call everything high, and capped at the
 * absolute 50. A fixed 50 put every repo in "Deprioritize" when the best score was 31.
 */
export function highOpportunityThreshold(scores: number[]): number {
  const s = scores.filter(x => Number.isFinite(x) && x > 0).sort((a, b) => a - b)
  if (s.length === 0) return ABSOLUTE_HIGH_OPPORTUNITY
  const p75 = s[Math.min(s.length - 1, Math.floor(s.length * 0.75))]
  return Math.min(ABSOLUTE_HIGH_OPPORTUNITY, Math.max(MIN_HIGH_OPPORTUNITY, p75))
}

export function getQuadrant(opportunityScore: number, effort: EffortLevel, highThreshold = ABSOLUTE_HIGH_OPPORTUNITY): {
  name: string
  color: string
  description: string
} {
  const highOpp = opportunityScore >= highThreshold
  const lowEffort = effort === 'low'

  if (highOpp && lowEffort)  return { name: 'Quick Win',     color: 'text-emerald-600', description: 'High value, low cost — do these first' }
  if (highOpp && !lowEffort) return { name: 'Invest',        color: 'text-blue-600',    description: 'High value, high cost — worth the commitment' }
  if (!highOpp && lowEffort) return { name: 'Fill-In',       color: 'text-slate-500',   description: 'Easy but low impact — do when blocked' }
  return                            { name: 'Deprioritize',  color: 'text-red-400',     description: 'High cost, low return — avoid for now' }
}
