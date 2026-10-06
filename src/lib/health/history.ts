import { db } from '@/lib/db'
import { healthScoreHistory, repositories } from '@/lib/db/schema'
import { eq, and, gte, sql } from 'drizzle-orm'

export interface HealthTrendPoint {
  date: string        // YYYY-MM-DD
  avgHealth: number
  avgSecurity: number
  avgActivity: number
}

export interface PortfolioHealthTrend {
  series: HealthTrendPoint[]
  snapshotDays: number
}

export interface HealthTrendRow {
  date: string
  healthScore?: number | null
  securityScore?: number | null
  activityScore?: number | null
}

export function buildHealthTrendSeries(
  rows: HealthTrendRow[],
  days = 30,
  now = new Date(),
): HealthTrendPoint[] {
  const start = new Date(now)
  start.setUTCHours(0, 0, 0, 0)
  const startMs = start.getTime() - (days - 1) * 86_400_000

  const byDate = new Map<string, { health: number; security: number; activity: number; count: number }>()
  for (const row of rows) {
    const date = row.date?.slice(0, 10)
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue
    const dateMs = new Date(`${date}T12:00:00Z`).getTime()
    if (dateMs < startMs || dateMs > start.getTime() + 86_400_000) continue

    const current = byDate.get(date) ?? { health: 0, security: 0, activity: 0, count: 0 }
    const health = Number(row.healthScore)
    const security = Number(row.securityScore)
    const activity = Number(row.activityScore)

    if (Number.isFinite(health)) current.health += health
    if (Number.isFinite(security)) current.security += security
    if (Number.isFinite(activity)) current.activity += activity
    current.count += 1
    byDate.set(date, current)
  }

  const series: HealthTrendPoint[] = []
  for (let i = days - 1; i >= 0; i--) {
    const date = new Date(start.getTime() - i * 86_400_000)
    const dateKey = date.toISOString().slice(0, 10)
    const bucket = byDate.get(dateKey)
    if (!bucket || bucket.count === 0) {
      series.push({ date: dateKey, avgHealth: 0, avgSecurity: 0, avgActivity: 0 })
      continue
    }

    series.push({
      date: dateKey,
      avgHealth: Number((bucket.health / bucket.count).toFixed(1)),
      avgSecurity: Number((bucket.security / bucket.count).toFixed(1)),
      avgActivity: Number((bucket.activity / bucket.count).toFixed(1)),
    })
  }

  return series
}

/** Newest health snapshot date (YYYY-MM-DD) across the user's repos, or null if none yet. */
export async function latestSnapshotDate(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ latest: sql<string | null>`max(${healthScoreHistory.recordedDate})::text` })
    .from(healthScoreHistory)
    .innerJoin(repositories, eq(healthScoreHistory.repoId, repositories.id))
    .where(eq(repositories.userId, userId))
  return row?.latest ?? null
}

export async function getPortfolioHealthTrend(userId: string, days = 30): Promise<PortfolioHealthTrend> {
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

  return {
    series: buildHealthTrendSeries(rows.map(r => ({
    date: r.date,
    healthScore: r.avgHealth ?? 0,
    securityScore: r.avgSecurity ?? 0,
    activityScore: r.avgActivity ?? 0,
    })), days),
    snapshotDays: rows.length,
  }
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

