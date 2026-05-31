import type { RepositoryMetrics } from '@/lib/db/schema'

/**
 * PRD formula:
 *   20% activity · 20% security · 15% deployment · 15% documentation
 *   10% testing · 10% dependency · 10% quality
 */
export function calculateHealthScore(
  metrics: Pick<
    RepositoryMetrics,
    | 'activityScore'
    | 'securityScore'
    | 'documentationScore'
    | 'testingScore'
    | 'dependencyScore'
    | 'qualityScore'
  > & { deploymentScore?: number },
): number {
  const activity = (metrics.activityScore ?? 0) * 0.20
  const security = (metrics.securityScore ?? 100) * 0.20
  const deployment = (metrics.deploymentScore ?? 50) * 0.15
  const documentation = (metrics.documentationScore ?? 0) * 0.15
  const testing = (metrics.testingScore ?? 0) * 0.10
  const dependency = (metrics.dependencyScore ?? 50) * 0.10
  const quality = (metrics.qualityScore ?? 70) * 0.10

  return Math.round(activity + security + deployment + documentation + testing + dependency + quality)
}

export function healthColor(score: number): 'green' | 'yellow' | 'red' {
  if (score >= 90) return 'green'
  if (score >= 70) return 'yellow'
  return 'red'
}

export function healthLabel(score: number): 'Healthy' | 'At Risk' | 'Dead' {
  if (score >= 90) return 'Healthy'
  if (score >= 70) return 'At Risk'
  return 'Dead'
}

// ─── Opportunity Score (Phase 4) ─────────────────────────────────────────────

export interface OpportunityInputs {
  healthScore: number
  activityScore: number
  stars: number
  mrr: number             // monthly revenue in dollars
  isRevenueGenerating: boolean
  hasLiveDeployment: boolean
}

/**
 * Revenue Potential sub-score (0-100).
 *
 * If the repo already earns money, score scales logarithmically:
 *   $10/mo → ~40  ·  $100/mo → ~65  ·  $1 000/mo → ~90  ·  $10 000/mo → 100
 *
 * Otherwise, estimate potential from:
 *   stars (popularity signal) + live deployment (shipped product signal) + activity
 */
export function calculateRevenuePotential(
  mrr: number,
  stars: number,
  hasLiveDeployment: boolean,
  activityScore: number,
): number {
  if (mrr > 0) {
    return Math.min(100, (Math.log10(mrr + 1) / Math.log10(10_001)) * 100)
  }
  const starsSignal = Math.min(40, (stars / 50) * 40)
  const deploySignal = hasLiveDeployment ? 30 : 0
  const activitySignal = activityScore * 0.30
  return Math.min(100, starsSignal + deploySignal + activitySignal)
}

/**
 * Traffic / Stars sub-score (0-100).
 * Logarithmic so that a 10-star repo isn't hopeless but 500+ stars is max.
 *   0 → 0  ·  5 → 24  ·  25 → 55  ·  100 → 80  ·  500 → 100
 */
export function calculateTrafficScore(stars: number): number {
  if (stars <= 0) return 0
  return Math.min(100, (Math.log10(stars + 1) / Math.log10(501)) * 100)
}

/**
 * Opportunity Score — which projects deserve your attention?
 *
 *   Revenue Potential × 30%
 *   Recent Activity   × 25%
 *   Health Score      × 25%
 *   Traffic / Stars   × 20%
 *
 * High score = high-value project worth investing time in.
 * Low score = low-signal project, or already perfect.
 */
export function calculateOpportunityScore(inputs: OpportunityInputs): number {
  const revPotential = calculateRevenuePotential(
    inputs.mrr,
    inputs.stars,
    inputs.hasLiveDeployment,
    inputs.activityScore,
  )
  const traffic = calculateTrafficScore(inputs.stars)

  return Math.round(
    revPotential * 0.30 +
    inputs.activityScore * 0.25 +
    inputs.healthScore * 0.25 +
    traffic * 0.20,
  )
}

export function opportunityLabel(score: number): string {
  if (score >= 80) return 'High'
  if (score >= 55) return 'Medium'
  return 'Low'
}
