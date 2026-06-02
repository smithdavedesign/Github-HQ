/**
 * Pure formatting helpers for the MCP coding brief.
 * Extracted for testability — no DB imports.
 */

export interface BriefRepo {
  name: string
  lifecycleStatus: string | null
  isFocused: boolean | null
  purpose: string | null
  estimatedEffort: string | null
  mrr: string | null
  isArchived: boolean | null
  abandonmentReason: string | null
  healthScore: number | null
  activityScore: number | null
  securityScore: number | null
  buildStatus: string | null
  activityStatus: string | null
  lastPush: Date | null
  techDebtLevel: string | null
  analysisScore: number | null
}

export interface AdvisorAction {
  repoId: number
  repoName: string
  action: string
  estimatedImpact: string
  effort: string
  reasoning: string
}

const SKIP_PURPOSES = new Set(['Reference', 'Infrastructure'])
const SKIP_LIFECYCLES = new Set(['archived', 'sunsetting'])

export function formatHealthLine(score: number | null): string {
  if (score == null) return '?/100'
  const label = score >= 75 ? '🟢' : score >= 55 ? '🟡' : '🔴'
  return `${label} ${Math.round(score)}/100`
}

export function formatLastPush(date: Date | null): string {
  if (!date) return 'never'
  const days = Math.floor((Date.now() - new Date(date).getTime()) / 86400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

export function isActionableRepo(repo: {
  isArchived: boolean | null
  lifecycleStatus: string | null
  purpose: string | null
}): boolean {
  if (repo.isArchived) return false
  if (SKIP_LIFECYCLES.has(repo.lifecycleStatus ?? '')) return false
  if (SKIP_PURPOSES.has(repo.purpose ?? '')) return false
  return true
}

export function pickNextAction(
  actions: AdvisorAction[],
  repoMap: Map<number, { isArchived: boolean | null; lifecycleStatus: string | null; purpose: string | null; isFocused: boolean | null }>,
): AdvisorAction | null {
  return actions.find(a => {
    const repo = repoMap.get(a.repoId)
    if (!repo) return false
    return isActionableRepo(repo)
  }) ?? null
}
