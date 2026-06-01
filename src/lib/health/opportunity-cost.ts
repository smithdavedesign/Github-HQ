export interface CostInput {
  id: number
  name: string
  opportunityScore: number
  weeklyCommits: number
  mrr: number
  isFocused: boolean
  lifecycleStatus: string | null
}

export interface OpportunityCostResult {
  workedOn: CostInput[]
  topMissed: CostInput[]
  avgWorkedScore: number
  topMissedScore: number
  scoreDelta: number
  hasSignificantCost: boolean   // only true when delta >= 10 and both lists non-empty
}

export function computeOpportunityCost(repos: CostInput[]): OpportunityCostResult {
  const active = repos.filter(r =>
    r.lifecycleStatus !== 'archived' && r.lifecycleStatus !== 'sunsetting'
  )

  const workedOn = active.filter(r => r.weeklyCommits > 0)
  const notWorked = active
    .filter(r => r.weeklyCommits === 0)
    .sort((a, b) => b.opportunityScore - a.opportunityScore)

  const topMissed = notWorked.slice(0, 3)

  const avgWorked = workedOn.length > 0
    ? workedOn.reduce((s, r) => s + r.opportunityScore, 0) / workedOn.length
    : 0

  const topMissedScore = topMissed[0]?.opportunityScore ?? 0
  const scoreDelta = Math.round(topMissedScore - avgWorked)

  return {
    workedOn,
    topMissed,
    avgWorkedScore: Math.round(avgWorked),
    topMissedScore: Math.round(topMissedScore),
    scoreDelta,
    hasSignificantCost: scoreDelta >= 10 && workedOn.length > 0 && topMissed.length > 0,
  }
}
