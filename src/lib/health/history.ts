import { db } from '@/lib/db'
import { healthScoreHistory, repositories } from '@/lib/db/schema'
import { eq, and, gte, sql } from 'drizzle-orm'

export interface HealthTrendPoint {
  date: string        // YYYY-MM-DD
  avgHealth: number
  avgSecurity: number
  avgActivity: number
}

export async function getPortfolioHealthTrend(userId: string, days = 30): Promise<HealthTrendPoint[]> {
  const since = new Date(Date.now() - days * 86400_000)

  const rows = await db
    .select({
      date: healthScoreHistory.recordedDate,
      avgHealth:   sql<number>`round(avg(${healthScoreHistory.healthScore})::numeric, 1)`.mapWith(Number),
      avgSecurity: sql<number>`round(avg(${healthScoreHistory.securityScore})::numeric, 1)`.mapWith(Number),
      avgActivity: sql<number>`round(avg(${healthScoreHistory.activityScore})::numeric, 1)`.mapWith(Number),
    })
    .from(healthScoreHistory)
    .innerJoin(repositories, eq(healthScoreHistory.repoId, repositories.id))
    .where(and(
      eq(repositories.userId, userId),
      gte(healthScoreHistory.recordedAt, since),
    ))
    .groupBy(healthScoreHistory.recordedDate)
    .orderBy(healthScoreHistory.recordedDate)

  return rows.map(r => ({
    date: r.date,
    avgHealth: r.avgHealth ?? 0,
    avgSecurity: r.avgSecurity ?? 0,
    avgActivity: r.avgActivity ?? 0,
  }))
}

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

