/**
 * Commit counts from GitHub's weekly commit-activity stats (`GET /repos/{o}/{r}/stats/commit_activity`).
 *
 * GitHub computes these lazily: for a repo nobody has looked at lately, the first request answers
 * 202 with an empty body and the numbers arrive on a later request. Sync used to read that as zero
 * commits, so Activity (20% of health) dropped to 0 at random and the drop raised health alerts
 * (found 2026-10-07: AI-Trend-Tracker at Activity 0 while the endpoint then reported 3 commits in
 * 4 weeks). Without fresh stats, the previous sync's counts are kept; the next sync refreshes them.
 *
 * Pure.
 */

export interface CommitCounts {
  weeklyCommits: number
  monthlyCommits: number
  quarterlyCommits: number
  weeklyCommitData: { week: number; total: number }[]
  /** False when GitHub was still computing and these are the previous sync's counts. */
  fresh: boolean
}

type Previous = {
  weeklyCommits?: number | null
  monthlyCommits?: number | null
  quarterlyCommits?: number | null
  weeklyCommitData?: unknown
} | null | undefined

export function commitCounts(stats: unknown, previous: Previous): CommitCounts {
  if (Array.isArray(stats)) {
    const weeks = (stats as { week?: number; total?: number }[]).slice(-13)
    return {
      weeklyCommitData: weeks.map(w => ({ week: w.week ?? 0, total: w.total ?? 0 })),
      quarterlyCommits: weeks.reduce((sum, w) => sum + (w.total ?? 0), 0),
      monthlyCommits: weeks.slice(-4).reduce((sum, w) => sum + (w.total ?? 0), 0),
      weeklyCommits: weeks[weeks.length - 1]?.total ?? 0,
      fresh: true,
    }
  }
  const data = Array.isArray(previous?.weeklyCommitData) ? previous.weeklyCommitData as { week: number; total: number }[] : []
  return {
    weeklyCommits: previous?.weeklyCommits ?? 0,
    monthlyCommits: previous?.monthlyCommits ?? 0,
    quarterlyCommits: previous?.quarterlyCommits ?? 0,
    weeklyCommitData: data,
    fresh: false,
  }
}
