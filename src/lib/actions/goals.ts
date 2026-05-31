'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { goals, repositories, repositoryMetrics, deployments } from '@/lib/db/schema'
import type { InsertGoal } from '@/lib/db/schema'
import { eq, and, sql, inArray } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import type { GoalType } from '@/lib/goals'
import { GOAL_PRESETS } from '@/lib/goals'

export type { GoalType }  // re-export for convenience

/** Compute current value for auto-tracked goal types */
async function computeCurrentValue(userId: string, type: GoalType): Promise<number> {
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

export async function getGoals() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  return db.query.goals.findMany({
    where: and(eq(goals.userId, session.user.id), eq(goals.isActive, true)),
    orderBy: (g, { asc }) => [asc(g.createdAt)],
  })
}

export async function createGoal(data: {
  type: GoalType
  name: string
  targetValue: number
  unit?: string
  deadline?: string
  notes?: string
}) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const preset = GOAL_PRESETS[data.type]
  const unit = data.unit ?? preset.unit

  // Compute current value immediately for auto-tracked types
  const currentValue = data.type !== 'custom'
    ? await computeCurrentValue(session.user.id, data.type)
    : 0

  await db.insert(goals).values({
    userId: session.user.id,
    type: data.type,
    name: data.name,
    targetValue: data.targetValue,
    currentValue,
    unit,
    deadline: data.deadline ?? null,
    notes: data.notes ?? null,
  } satisfies InsertGoal)

  revalidatePath('/')
  revalidatePath('/settings')
}

export async function updateGoalProgress(goalId: number, currentValue: number) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const goal = await db.query.goals.findFirst({
    where: and(eq(goals.id, goalId), eq(goals.userId, session.user.id)),
  })
  if (!goal) throw new Error('Goal not found')

  const completed = currentValue >= (goal.targetValue ?? 0)
  await db.update(goals)
    .set({
      currentValue,
      completedAt: completed && !goal.completedAt ? new Date() : goal.completedAt,
    })
    .where(eq(goals.id, goalId))

  revalidatePath('/')
}

export async function updateCustomGoalProgress(goalId: number, currentValue: number) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const goal = await db.query.goals.findFirst({
    where: and(eq(goals.id, goalId), eq(goals.userId, session.user.id), eq(goals.type, 'custom')),
  })
  if (!goal) throw new Error('Not found')

  const completed = currentValue >= (goal.targetValue ?? 0)
  await db.update(goals).set({
    currentValue,
    completedAt: completed && !goal.completedAt ? new Date() : goal.completedAt,
  }).where(eq(goals.id, goalId))

  revalidatePath('/')
}

export async function deleteGoal(goalId: number) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  await db.delete(goals).where(
    and(eq(goals.id, goalId), eq(goals.userId, session.user.id))
  )
  revalidatePath('/')
  revalidatePath('/settings')
}

/** Called after each sync to refresh all auto-tracked goal values */
export async function refreshGoalProgress(userId: string) {
  const activeGoals = await db.query.goals.findMany({
    where: and(eq(goals.userId, userId), eq(goals.isActive, true)),
  })

  for (const goal of activeGoals) {
    if (goal.type === 'custom') continue
    try {
      const current = await computeCurrentValue(userId, goal.type as GoalType)
      const completed = current >= (goal.targetValue ?? 0)
      await db.update(goals).set({
        currentValue: current,
        completedAt: completed && !goal.completedAt ? new Date() : goal.completedAt,
      }).where(eq(goals.id, goal.id))
    } catch {
      // Non-fatal
    }
  }
}
