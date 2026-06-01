export interface RepoScoreInput {
  healthScore: number
  activityStatus: string | null
  mrr: number
  isArchived: boolean
  lifecycleStatus: string | null
}

export interface PortfolioScoreBreakdown {
  score: number
  avgHealth: number
  activityRatio: number  // 0-100: % of active repos that are Actively Maintained
  revenueScore: number   // 0-100: scales with MRR up to $1000/mo
  diversityScore: number // 0-100: % of repos in productive lifecycle stages
}

const PRODUCTIVE_STAGES = new Set(['beta', 'production', 'growing', 'maintaining'])

export function calculatePortfolioScore(repos: RepoScoreInput[]): PortfolioScoreBreakdown {
  const active = repos.filter(r => !r.isArchived && r.lifecycleStatus !== 'archived')

  if (active.length === 0) {
    return { score: 0, avgHealth: 0, activityRatio: 0, revenueScore: 0, diversityScore: 0 }
  }

  const avgHealth = active.reduce((sum, r) => sum + r.healthScore, 0) / active.length

  const activelyMaintained = active.filter(r => r.activityStatus === 'Actively Maintained').length
  const activityRatio = (activelyMaintained / active.length) * 100

  const totalMrr = active.reduce((sum, r) => sum + r.mrr, 0)
  const revenueScore = Math.min(100, (totalMrr / 1000) * 100)

  const productive = active.filter(r => PRODUCTIVE_STAGES.has(r.lifecycleStatus ?? '')).length
  const diversityScore = Math.min(100, (productive / active.length) * 100)

  const score = Math.round(
    avgHealth * 0.40 +
    activityRatio * 0.25 +
    revenueScore * 0.25 +
    diversityScore * 0.10,
  )

  return {
    score,
    avgHealth: Math.round(avgHealth),
    activityRatio: Math.round(activityRatio),
    revenueScore: Math.round(revenueScore),
    diversityScore: Math.round(diversityScore),
  }
}

export function portfolioGrade(score: number): { grade: string; label: string } {
  if (score >= 85) return { grade: 'A', label: 'Excellent' }
  if (score >= 70) return { grade: 'B', label: 'Great' }
  if (score >= 55) return { grade: 'C', label: 'Good' }
  if (score >= 40) return { grade: 'D', label: 'Fair' }
  return { grade: 'F', label: 'Needs Work' }
}
