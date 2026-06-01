// Effort level → estimated hours per unit of improvement
const EFFORT_HOURS: Record<string, number> = { low: 2, medium: 8, high: 20 }

export interface SimulationInput {
  repoId: number
  repoName: string
  opportunityScore: number
  healthScore: number
  activityScore: number
  mrr: number
  isRevenueGenerating: boolean
  hasLiveDeployment: boolean
  openCriticalFindings: number
  estimatedEffort: string | null
  lifecycleStatus: string | null
  isFocused: boolean
  // Pre-computed deltas from advisor
  withDeploy: number | null
  withSecurity: number | null
  withActivity: number | null
  withRevenue: number | null
}

export interface SimulationAction {
  repoId: number
  repoName: string
  action: string
  actionType: 'deploy' | 'security' | 'activity' | 'revenue'
  estimatedHours: number
  opportunityDelta: number
  roiPerHour: number
  projectedMrr: number  // additional MRR if revenue action taken
}

export interface SimulationResult {
  allocations: SimulationAction[]
  remainingHours: number
  totalOpportunityDelta: number
  totalProjectedMrr: number
  newPortfolioScore: number | null
  coverageNotes: string[]
}

export type GoalType = 'max_opportunity' | 'max_revenue' | 'max_health'

function candidateActions(repo: SimulationInput, goalType: GoalType): SimulationAction[] {
  const candidates: SimulationAction[] = []
  const hours = EFFORT_HOURS[repo.estimatedEffort ?? 'medium'] ?? 8

  if (repo.withDeploy != null && repo.withDeploy > 0) {
    const roi = repo.withDeploy / Math.max(hours * 0.5, 0.5)
    candidates.push({
      repoId: repo.repoId, repoName: repo.repoName,
      action: `Add a production deployment to ${repo.repoName}`,
      actionType: 'deploy',
      estimatedHours: Math.max(1, hours * 0.5),
      opportunityDelta: repo.withDeploy,
      roiPerHour: roi,
      projectedMrr: 0,
    })
  }

  if (repo.withSecurity != null && repo.withSecurity > 0) {
    const hrs = Math.max(1, repo.openCriticalFindings * 0.5)
    candidates.push({
      repoId: repo.repoId, repoName: repo.repoName,
      action: `Fix ${repo.openCriticalFindings} critical/high security alert${repo.openCriticalFindings > 1 ? 's' : ''} in ${repo.repoName}`,
      actionType: 'security',
      estimatedHours: hrs,
      opportunityDelta: repo.withSecurity,
      roiPerHour: repo.withSecurity / hrs,
      projectedMrr: 0,
    })
  }

  if (repo.withActivity != null && repo.withActivity > 0) {
    candidates.push({
      repoId: repo.repoId, repoName: repo.repoName,
      action: `Resume active development on ${repo.repoName}`,
      actionType: 'activity',
      estimatedHours: hours,
      opportunityDelta: repo.withActivity,
      roiPerHour: repo.withActivity / hours,
      projectedMrr: 0,
    })
  }

  if (repo.withRevenue != null && repo.withRevenue > 0 && goalType !== 'max_health') {
    const hrs = hours * 2  // revenue requires more work
    const projMrr = 100  // conservative: $100 MRR is the assumption
    candidates.push({
      repoId: repo.repoId, repoName: repo.repoName,
      action: `Add monetisation to ${repo.repoName} (e.g. paid tier, sponsorship)`,
      actionType: 'revenue',
      estimatedHours: hrs,
      opportunityDelta: repo.withRevenue,
      roiPerHour: repo.withRevenue / hrs,
      projectedMrr: projMrr,
    })
  }

  return candidates
}

function sortKey(action: SimulationAction, goalType: GoalType): number {
  if (goalType === 'max_revenue') {
    return action.projectedMrr > 0 ? action.projectedMrr * 100 + action.opportunityDelta : action.roiPerHour
  }
  if (goalType === 'max_health') {
    return action.actionType === 'security' ? action.roiPerHour * 2 : action.roiPerHour
  }
  return action.roiPerHour
}

export function runSimulation(
  repos: SimulationInput[],
  availableHours: number,
  goalType: GoalType,
  currentPortfolioScore: number | null,
): SimulationResult {
  // Only consider active, non-archived repos
  const active = repos.filter(r =>
    r.lifecycleStatus !== 'archived' &&
    r.lifecycleStatus !== 'sunsetting'
  )

  // Collect all candidate actions, sorted by goal-specific ROI
  const allCandidates = active
    .flatMap(r => candidateActions(r, goalType))
    .sort((a, b) => sortKey(b, goalType) - sortKey(a, goalType))

  // Greedy allocation: pick highest-value actions that fit in the budget
  const allocations: SimulationAction[] = []
  const usedRepos = new Set<number>()
  let remaining = availableHours
  let totalDelta = 0
  let totalMrr = 0

  for (const action of allCandidates) {
    if (remaining <= 0) break
    if (action.estimatedHours > remaining) continue
    // Only one action per repo to keep recommendations clean
    if (usedRepos.has(action.repoId)) continue

    allocations.push(action)
    usedRepos.add(action.repoId)
    remaining -= action.estimatedHours
    totalDelta += action.opportunityDelta
    totalMrr += action.projectedMrr
  }

  const notes: string[] = []
  if (allocations.length === 0) {
    notes.push('No clear high-ROI actions found with available hours. Try increasing hours or running a fresh sync.')
  }
  if (remaining >= 4) {
    notes.push(`${remaining.toFixed(0)}h unallocated — consider using this for longer-term investments or rest.`)
  }

  // Rough portfolio score projection: each opportunity delta point ≈ 0.3 portfolio score points
  const newPortfolioScore = currentPortfolioScore != null
    ? Math.min(100, Math.round(currentPortfolioScore + totalDelta * 0.3))
    : null

  return {
    allocations,
    remainingHours: remaining,
    totalOpportunityDelta: Math.round(totalDelta),
    totalProjectedMrr: totalMrr,
    newPortfolioScore,
    coverageNotes: notes,
  }
}
