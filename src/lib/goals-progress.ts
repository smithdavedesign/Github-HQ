import 'server-only'

import { db } from '@/lib/db'
import { goals, repositories, repositoryMetrics, deployments } from '@/lib/db/schema'
import { eq, and, sql, inArray } from 'drizzle-orm'
import type { GoalType } from '@/lib/goals'

// Goal values for a given user. Server-only (not a server action): the userId comes from the
// caller — the session in src/lib/actions/goals.ts, or the sync cron.

/** Compute current value for auto-tracked goal types */
export async function computeCurrentValue(userId: string, type: GoalType): Promise<number> {
  const userRepoIds = (await db
    .select({ id: repositories.id })
    .from(repositories)
    .where(eq(repositories.userId, userId))
  ).map(r => r.id)

  if (userRepoIds.length === 0) return 0

  switch (type) {
    case 'mrr': {
      const [row] = await db
        .select({ total: sql<number>`coalesce(sum(mrr::numeric), 0)`.mapWith(Number) })
        .from(repositories)
        .where(eq(repositories.userId, userId))
      return Math.round(row?.total ?? 0)
    }
    case 'health_avg': {
      const [row] = await db
        .select({ avg: sql<number>`coalesce(avg(${repositoryMetrics.healthScore}), 0)`.mapWith(Number) })
        .from(repositoryMetrics)
        .where(inArray(repositoryMetrics.repoId, userRepoIds))
      return Math.round(row?.avg ?? 0)
    }
    case 'repos_live': {
      const [row] = await db
        .select({ count: sql<number>`count(distinct ${deployments.repoId})`.mapWith(Number) })
        .from(deployments)
        .where(
          and(
            inArray(deployments.repoId, userRepoIds),
            sql`${deployments.status} in ('healthy', 'slow')`,
          )
        )
      return row?.count ?? 0
    }
    case 'revenue_repos': {
      const [row] = await db
        .select({ count: sql<number>`count(*)`.mapWith(Number) })
        .from(repositories)
        .where(and(eq(repositories.userId, userId), eq(repositories.isRevenueGenerating, true)))
      return row?.count ?? 0
    }
    case 'custom':
      return 0  // manually updated
  }
}

/** Called after each sync to refresh all auto-tracked goal values */
export async function refreshGoalProgress(userId: string) {
  const activeGoals = await db.query.goals.findMany({
    where: and(eq(goals.userId, userId), eq(goals.isActive, true)),
  })

  // Compute all values in parallel, then batch the updates with Promise.all
  // (was N sequential DB round-trips — now 1 parallel compute + N parallel updates)
  const updates = await Promise.allSettled(
    activeGoals
      .filter(g => g.type !== 'custom')
      .map(async goal => {
        const current = await computeCurrentValue(userId, goal.type as GoalType)
        const completed = current >= (goal.targetValue ?? 0)
        return { id: goal.id, current, completed, goal }
      })
  )

  await Promise.all(
    updates
      .filter((r): r is PromiseFulfilledResult<{ id: number; current: number; completed: boolean; goal: typeof activeGoals[0] }> =>
        r.status === 'fulfilled'
      )
      .map(({ value: { id, current, completed, goal } }) =>
        db.update(goals).set({
          currentValue: current,
          completedAt: completed && !goal.completedAt ? new Date() : goal.completedAt,
        }).where(eq(goals.id, id)).catch(() => null) // non-fatal per-goal
      )
  )
}
