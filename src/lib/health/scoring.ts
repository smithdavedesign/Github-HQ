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

// ─── Archive Score (Phase 22) ─────────────────────────────────────────────────

export interface ArchiveInputs {
  quarterlyCommits: number      // commits in last 90 days
  mrr: number                   // monthly revenue ($ )
  hasLiveDeployment: boolean    // any deployment configured
  healthScore: number           // 0-100
  opportunityScore: number      // 0-100
  daysSinceLastPush: number     // days since last git push
  isArchived: boolean           // already archived on GitHub
}

/**
 * Archive Score — how strongly should this repo be archived?
 *
 *   Inactivity       × 35%   (commits + days since push)
 *   No revenue       × 25%   (zero MRR is a strong signal)
 *   No deployment    × 20%   (not shipped = low stakes)
 *   Low health       × 10%   (poor quality, not worth saving)
 *   Low opportunity  × 10%   (little upside)
 *
 * Score 0-100; > 70 = strong archive candidate.
 * Repos with MRR > 0 are capped at 30 (never strong candidates).
 */
export function calculateArchiveScore(inputs: ArchiveInputs): number {
  if (inputs.isArchived) return 0  // already archived — don't surface again

  // Inactivity sub-score (0-100): no commits in 90 days = full score
  const commitInactivity = inputs.quarterlyCommits === 0 ? 100 : Math.max(0, 100 - inputs.quarterlyCommits * 5)
  const pushInactivity = Math.min(100, (inputs.daysSinceLastPush / 365) * 100)
  const inactivityScore = (commitInactivity * 0.6 + pushInactivity * 0.4)

  // Revenue signal (0-100): no revenue = 100, revenue drops score sharply
  const revenueScore = inputs.mrr > 0 ? 0 : 100

  // No deployment (0 or 100)
  const noDeployScore = inputs.hasLiveDeployment ? 0 : 100

  // Low health inverted (0-100)
  const lowHealthScore = Math.max(0, 100 - inputs.healthScore)

  // Low opportunity inverted (0-100)
  const lowOppScore = Math.max(0, 100 - inputs.opportunityScore)

  const raw = Math.round(
    inactivityScore * 0.35 +
    revenueScore    * 0.25 +
    noDeployScore   * 0.20 +
    lowHealthScore  * 0.10 +
    lowOppScore     * 0.10,
  )

  // Revenue repos are never strong archive candidates
  if (inputs.mrr > 0) return Math.min(30, raw)

  return Math.min(100, raw)
}

export function archiveLabel(score: number): 'Strong' | 'Moderate' | 'Unlikely' {
  if (score >= 70) return 'Strong'
  if (score >= 45) return 'Moderate'
  return 'Unlikely'
}

// ─── Time Allocation (Phase 25) ──────────────────────────────────────────────

export interface TimeAllocationInput {
  repoId: number
  repoName: string
  opportunityScore: number
  healthScore: number
  estimatedValue: number        // current USD valuation
  isFocused: boolean
  mrr: number
  hasLiveDeployment: boolean
  activityScore: number
  archiveScore: number
}

export interface TimeAllocationItem {
  repoId: number
  repoName: string
  projectedValueDelta: number   // USD
  rationale: string             // short human-readable reason
  priorityScore: number         // internal sort key
}

/**
 * Rank repos by expected value-per-hour of attention.
 * Returns the top N repos, excluding strong archive candidates (score ≥ 70).
 */
export function calculateTimeAllocation(
  repos: TimeAllocationInput[],
  topN = 3,
): TimeAllocationItem[] {
  return repos
    .filter(r => r.archiveScore < 70)  // skip dead-end repos
    .map(r => {
      // How much health improvement headroom is there?
      const healthGap = Math.max(0, 90 - r.healthScore)
      // Health improvement proxy: $50 per point of health gap (rough signal)
      const healthUplift = healthGap * 50

      // Opportunity gap: for non-revenue repos, each opp point ≈ $200 value potential
      const oppGap = Math.max(0, 80 - r.opportunityScore)
      const oppUplift = r.mrr === 0 ? oppGap * 200 : oppGap * 100

      // Revenue repos get a multiplier because the downside of neglect is real
      const revenueMultiplier = r.mrr > 0 ? 2.5 : 1

      // Focused repos get a small boost so the advisor confirms their priority
      const focusBonus = r.isFocused ? 1.2 : 1

      const projectedValueDelta = Math.round(
        (healthUplift + oppUplift) * revenueMultiplier * focusBonus,
      )

      // Build rationale
      let rationale = ''
      if (r.mrr > 0) rationale = `$${r.mrr}/mo revenue — protect and grow`
      else if (healthGap > 20) rationale = `Health ${r.healthScore} → potential 90+ with attention`
      else if (oppGap > 20) rationale = `Opportunity gap — ${r.opportunityScore} now, 80+ possible`
      else if (r.isFocused) rationale = 'Marked as focus project'
      else rationale = 'High upside relative to current state'

      return {
        repoId: r.repoId,
        repoName: r.repoName,
        projectedValueDelta,
        rationale,
        priorityScore: projectedValueDelta,
      }
    })
    .sort((a, b) => b.priorityScore - a.priorityScore)
    .slice(0, topN)
}
