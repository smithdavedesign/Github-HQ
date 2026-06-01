import { db } from '@/lib/db'
import { healthScoreHistory, repositories } from '@/lib/db/schema'
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

  const rows = userRepos
    .filter(r => r.metrics?.healthScore != null)
    .map(r => ({
      repoId: r.id,
      healthScore: r.metrics!.healthScore!,
      activityScore: r.metrics!.activityScore,
      securityScore: r.metrics!.securityScore,
      recordedDate: today,
    }))

  if (rows.length === 0) return 0

  await db.insert(healthScoreHistory).values(rows).onConflictDoNothing()
  return rows.length
}

export interface TrendInfo {
  direction: 'up' | 'down' | 'flat' | 'new'
  delta: number
  days: number
}

