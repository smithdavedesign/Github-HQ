export interface ShowcaseInput {
  id: number
  name: string
  description: string | null
  visibility: string
  stars: number
  healthScore: number
  isFocused: boolean
  hasDeployment: boolean
  purpose: string | null
  lifecycleStatus: string | null
  activityStatus: string | null
  language: string | null
}

export interface ShowcaseRepo extends ShowcaseInput {
  showcaseScore: number
}

const PURPOSE_BONUS: Record<string, number> = {
  'Portfolio':       100,
  'Open Source':     95,
  'Revenue':         90,
  'Consulting':      75,
  'Client Work':     70,
  'Learning':        40,
  'Experiment':      30,
  'Infrastructure':  20,
  'Reference':        0,   // not meant to be showcased
}

export function calculateShowcaseScore(repo: ShowcaseInput): number {
  // Only public repos can be showcased on a GitHub profile
  if (repo.visibility !== 'public') return 0
  if (['archived', 'sunsetting'].includes(repo.lifecycleStatus ?? '')) return 0
  // Reference repos are intentionally dormant snapshots — not for showcasing
  if (repo.purpose === 'Reference') return 0

  const health    = repo.healthScore * 0.40
  const stars     = Math.min(40, Math.log2(repo.stars + 2) * 8) * 0.20   // log scale, 500+ stars ≈ 40
  const focused   = (repo.isFocused ? 100 : 0) * 0.15
  const deployed  = (repo.hasDeployment ? 100 : 0) * 0.15
  const purpose   = (PURPOSE_BONUS[repo.purpose ?? ''] ?? 50) * 0.10

  return Math.round(health + stars + focused + deployed + purpose)
}

export function getShowcaseRecommendations(repos: ShowcaseInput[], topN = 6): ShowcaseRepo[] {
  return repos
    .map(r => ({ ...r, showcaseScore: calculateShowcaseScore(r) }))
    .filter(r => r.showcaseScore > 0)
    .sort((a, b) => b.showcaseScore - a.showcaseScore)
    .slice(0, topN)
}
