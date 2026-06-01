import { toNum } from '@/lib/utils'
import { db } from '@/lib/db'
import { repositories, portfolioScoreHistory } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { calculatePortfolioScore } from './portfolio-score'
import type { PortfolioScoreBreakdown } from './portfolio-score'

export type { PortfolioScoreBreakdown }

export async function snapshotPortfolioScore(userId: string): Promise<PortfolioScoreBreakdown> {
  const today = new Date().toISOString().split('T')[0]

  const userRepos = await db.query.repositories.findMany({
    where: eq(repositories.userId, userId),
    with: { metrics: { columns: { healthScore: true, activityStatus: true } } },
    columns: { isArchived: true, lifecycleStatus: true, mrr: true },
  })

  const inputs = userRepos.map(r => ({
    healthScore: r.metrics?.healthScore ?? 0,
    activityStatus: r.metrics?.activityStatus ?? null,
    mrr: toNum(r.mrr),
    isArchived: r.isArchived ?? false,
    lifecycleStatus: r.lifecycleStatus,
  }))

  const breakdown = calculatePortfolioScore(inputs)

  await db
    .insert(portfolioScoreHistory)
    .values({
      userId,
      score: breakdown.score,
      avgHealth: breakdown.avgHealth,
      activityRatio: breakdown.activityRatio,
      revenueScore: breakdown.revenueScore,
      diversityScore: breakdown.diversityScore,
      recordedDate: today,
    })
    .onConflictDoNothing()

  return breakdown
}

export async function getPortfolioScoreTrend(userId: string): Promise<{
  current: PortfolioScoreBreakdown | null
  weekDelta: number | null
}> {
  const history = await db.query.portfolioScoreHistory.findMany({
    where: eq(portfolioScoreHistory.userId, userId),
    orderBy: (h, { desc }) => [desc(h.recordedDate)],
    limit: 14,
  })

  if (history.length === 0) return { current: null, weekDelta: null }

  const latest = history[0]
  const current: PortfolioScoreBreakdown = {
    score: latest.score,
    avgHealth: latest.avgHealth ?? 0,
    activityRatio: latest.activityRatio ?? 0,
    revenueScore: latest.revenueScore ?? 0,
    diversityScore: latest.diversityScore ?? 0,
  }

  const weekAgo = history.find(h => {
    const days = Math.round(
      (new Date(latest.recordedDate).getTime() - new Date(h.recordedDate).getTime()) / 86400_000
    )
    return days >= 6
  })

  const weekDelta = weekAgo != null ? Math.round(latest.score - weekAgo.score) : null

  return { current, weekDelta }
}
