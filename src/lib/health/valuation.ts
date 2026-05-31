/**
 * Repository Valuation Engine (Phase 15)
 *
 * Two methods:
 *
 * saas_multiple  — for revenue-generating repos
 *   Estimated value = MRR × monthly multiple (36–60×)
 *   Multiple is adjusted by health score (quality proxy) and activity (momentum proxy)
 *   Range: $10/mo × 36× health=0.5 ≈ $180  …  $5k/mo × 60× health=1.0 = $300k
 *
 * signal_based — for non-revenue repos
 *   Estimated value = (stars × $20 + deployment_bonus) × activity_factor × health_factor
 *   Based on rough open-source acquisition / sponsorship comps.
 *   Intentionally conservative — most 0-star private repos = $0.
 *
 * Confidence tiers:
 *   none      — archived, or all signals are zero
 *   very_low  — non-revenue, few stars
 *   low       — non-revenue with stars OR low MRR
 *   medium    — meaningful MRR (>$500/mo)
 *   high      — strong MRR (>$3k/mo) — not yet used, reserved for future growth data
 */

export type ValuationConfidence = 'none' | 'very_low' | 'low' | 'medium' | 'high'
export type ValuationMethod = 'saas_multiple' | 'signal_based' | 'archived'

export interface ValuationInputs {
  mrr: number           // monthly revenue in dollars
  stars: number
  healthScore: number   // 0-100
  activityScore: number // 0-100
  hasLiveDeployment: boolean
  isArchived: boolean
  isRevenueGenerating: boolean
}

export interface ValuationResult {
  estimatedValue: number        // USD
  valuationConfidence: ValuationConfidence
  valuationMethod: ValuationMethod
  annualizedValue: number       // estimatedValue × 12 (for display)
}

export function calculateValuation(inputs: ValuationInputs): ValuationResult {
  const { mrr, stars, healthScore, activityScore, hasLiveDeployment, isArchived } = inputs

  // Archived repos have no meaningful valuation
  if (isArchived) {
    return { estimatedValue: 0, valuationConfidence: 'none', valuationMethod: 'archived', annualizedValue: 0 }
  }

  // --- SaaS multiple method (revenue repos) ---
  if (mrr > 0) {
    // Base multiple: 36–60× monthly revenue
    // Higher multiples for healthier, more active repos (better exit multiples)
    const healthFactor = 0.6 + (healthScore / 100) * 0.4  // 0.6 → 1.0
    const baseMultiple = 36 + (healthScore / 100) * 24     // 36 → 60
    const activityFactor = 0.7 + (activityScore / 100) * 0.3  // 0.7 → 1.0
    const multiple = baseMultiple * activityFactor

    const estimatedValue = Math.round(mrr * multiple * healthFactor)
    const confidence: ValuationConfidence = mrr >= 3000 ? 'medium' : mrr >= 500 ? 'low' : 'very_low'

    return {
      estimatedValue,
      valuationConfidence: confidence,
      valuationMethod: 'saas_multiple',
      annualizedValue: Math.round(mrr * 12),
    }
  }

  // --- Signal-based method (non-revenue repos) ---
  // $20 per GitHub star — rough proxy for open-source project value
  const starValue = Math.round(stars * 20)

  // Live deployment = shipped product signal (adds 50% of star value, min $500)
  const deployBonus = hasLiveDeployment ? Math.max(500, Math.round(starValue * 0.5)) : 0

  // Activity and health adjust the base
  const activityFactor = Math.max(0.15, activityScore / 100)  // floor at 15%
  const healthFactor = Math.max(0.20, healthScore / 100)        // floor at 20%

  const raw = (starValue + deployBonus) * activityFactor * healthFactor
  const estimatedValue = Math.round(raw)

  // Confidence based on how much signal we actually have
  let confidence: ValuationConfidence = 'none'
  if (stars >= 100) confidence = 'low'
  else if (stars >= 20 || hasLiveDeployment) confidence = 'very_low'
  else if (stars > 0) confidence = 'very_low'

  return {
    estimatedValue,
    valuationConfidence: confidence,
    valuationMethod: 'signal_based',
    annualizedValue: 0,
  }
}

/** Format a valuation for display */
export function formatValuation(value: number): string {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}k`
  if (value > 0) return `$${value.toLocaleString()}`
  return '—'
}

export const CONFIDENCE_LABEL: Record<ValuationConfidence, string> = {
  none: 'No estimate',
  very_low: 'Very rough estimate',
  low: 'Rough estimate',
  medium: 'Moderate confidence',
  high: 'High confidence',
}
