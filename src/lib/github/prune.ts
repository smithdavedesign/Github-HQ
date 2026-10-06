/**
 * Which tracked repos to remove after a sync: the ones missing from a complete GitHub listing
 * (deleted, or transferred to another owner). A rename keeps the same GitHub id, so it's an
 * update, never a prune.
 *
 * Pure. Deleting cascades to the repo's metrics and history, so a listing that looks wrong
 * (empty, or missing a large share of what's tracked) prunes nothing and says why.
 */

export interface PrunePlan {
  /** Local repository ids to delete. */
  ids: number[]
  /** Why nothing was pruned although repos were missing; null when the plan is safe to apply. */
  skipped: string | null
}

/** At most this share of tracked repos may vanish in one sync (and always at least MIN_PRUNE). */
export const MAX_PRUNE_SHARE = 0.2
const MIN_PRUNE = 3

export function planPrune(
  tracked: { id: number; githubId: number }[],
  listedGithubIds: ReadonlySet<number>,
): PrunePlan {
  if (listedGithubIds.size === 0) {
    return { ids: [], skipped: tracked.length ? 'GitHub returned no repos; not pruning' : null }
  }
  const missing = tracked.filter(r => !listedGithubIds.has(r.githubId)).map(r => r.id)
  const limit = Math.max(MIN_PRUNE, Math.floor(tracked.length * MAX_PRUNE_SHARE))
  if (missing.length > limit) {
    return { ids: [], skipped: `${missing.length} of ${tracked.length} tracked repos missing from GitHub (limit ${limit}); not pruning` }
  }
  return { ids: missing, skipped: null }
}
