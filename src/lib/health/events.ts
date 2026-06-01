export interface EventToInsert {
  eventType: string
  title: string
  description?: string
  metadata?: Record<string, unknown>
  dedupKey?: string
}

export interface RepoDepInfo {
  repoId: number
  repoName: string
  packageName: string | null
  depNames: string[]
}

/**
 * Pure function: given repo state before and after sync, return portfolio events to insert.
 * Callers add userId/repoId and persist with onConflictDoNothing for dedup.
 */
export function computePortfolioEvents(
  repoId: number,
  repoName: string,
  description: string | null,
  newIsArchived: boolean,
  state: {
    isNew: boolean
    existingMrr: number
    newMrr: number
    existingIsArchived: boolean
    oldHealthScore: number
    newHealthScore: number
  },
): EventToInsert[] {
  const events: EventToInsert[] = []

  if (state.isNew) {
    events.push({
      eventType: 'repo_created',
      title: `Added ${repoName} to portfolio`,
      description: description ?? undefined,
      dedupKey: `repo_created:${repoId}`,
    })
  }

  if (!state.existingIsArchived && newIsArchived) {
    events.push({
      eventType: 'repo_archived',
      title: `Archived ${repoName}`,
      dedupKey: `repo_archived:${repoId}`,
    })
  }

  if (state.existingMrr === 0 && state.newMrr > 0) {
    events.push({
      eventType: 'first_revenue',
      title: `${repoName} earned its first revenue`,
      description: `MRR: $${state.newMrr.toFixed(2)}/mo`,
      metadata: { mrr: state.newMrr },
      dedupKey: `first_revenue:${repoId}`,
    })
  } else if (!state.isNew && Math.abs(state.newMrr - state.existingMrr) >= 10) {
    events.push({
      eventType: 'mrr_changed',
      title: `${repoName} MRR ${state.newMrr > state.existingMrr ? 'increased' : 'decreased'} to $${state.newMrr.toFixed(0)}/mo`,
      metadata: { from: state.existingMrr, to: state.newMrr },
    })
  }

  for (const threshold of [90, 80, 70] as const) {
    if (state.oldHealthScore < threshold && state.newHealthScore >= threshold) {
      events.push({
        eventType: 'health_milestone',
        title: `${repoName} reached ${threshold} health score`,
        description: `Score improved from ${Math.round(state.oldHealthScore)} to ${Math.round(state.newHealthScore)}`,
        metadata: { threshold, from: Math.round(state.oldHealthScore), to: Math.round(state.newHealthScore) },
        dedupKey: `health_milestone:${repoId}:${threshold}`,
      })
    }
  }

  return events
}

/**
 * Pure function: given dep infos for all repos, return a map of repoId → internal dep names.
 * Internal dep = another portfolio repo's package name appears in this repo's dependencies.
 */
export function computeInternalDeps(depInfos: RepoDepInfo[]): Map<number, string[]> {
  const pkgNameToRepoId = new Map<string, number>()
  for (const info of depInfos) {
    if (info.packageName) pkgNameToRepoId.set(info.packageName, info.repoId)
  }

  const result = new Map<number, string[]>()
  for (const info of depInfos) {
    const deps = info.depNames.filter(
      dep => pkgNameToRepoId.has(dep) && pkgNameToRepoId.get(dep) !== info.repoId,
    )
    result.set(info.repoId, deps)
  }
  return result
}
