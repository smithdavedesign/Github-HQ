import { db } from '@/lib/db'
import { healthScoreHistory, repositoryMetrics, repositories } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

/**
 * Snapshot today's health scores for every repo belonging to a user.
 * Safe to call multiple times — unique constraint on (repo_id, recorded_date)
 * means subsequent calls in the same day are no-ops via ON CONFLICT DO NOTHING.
 */
export async function snapshotHealthScores(userId: string): Promise<number> {
  const today = new Date().toISOString().split('T')[0] // YYYY-MM-DD

  const userRepos = await db.query.repositories.findMany({
    where: eq(repositories.userId, userId),
    with: { metrics: true },
    columns: { id: true },
  })

  let written = 0
  for (const repo of userRepos) {
    if (!repo.metrics?.healthScore) continue

    await db
      .insert(healthScoreHistory)
      .values({
        repoId: repo.id,
        healthScore: repo.metrics.healthScore,
        activityScore: repo.metrics.activityScore,
        securityScore: repo.metrics.securityScore,
        recordedDate: today,
      })
      .onConflictDoNothing()  // one snapshot per repo per day

    written++
  }
  return written
}

export interface TrendInfo {
  direction: 'up' | 'down' | 'flat' | 'new'
  delta: number   // score points, positive = improved
  days: number    // how far back the comparison goes
}

/**
 * Compute week-over-week health trend for a single repo.
 * Returns null if not enough history (< 7 days).
 */
export async function getHealthTrend(repoId: number, currentScore: number): Promise<TrendInfo | null> {
  // Get the oldest record in the last 7-14 days to compare against
  const history = await db.query.healthScoreHistory.findMany({
    where: eq(healthScoreHistory.repoId, repoId),
    orderBy: (h, { asc }) => [asc(h.recordedDate)],
    limit: 30,
  })

  if (history.length < 2) return null

  const oldest = history[0]
  const oldDate = new Date(oldest.recordedDate)
  const days = Math.round((Date.now() - oldDate.getTime()) / (1000 * 60 * 60 * 24))

  if (days < 5) return null  // not enough time elapsed

  const delta = Math.round(currentScore - oldest.healthScore)
  const direction: TrendInfo['direction'] =
    delta > 2 ? 'up' : delta < -2 ? 'down' : 'flat'

  return { direction, delta, days }
}
