'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { goals, repositories, repositoryMetrics, deployments } from '@/lib/db/schema'
import type { InsertGoal } from '@/lib/db/schema'
import { eq, and, sql, inArray } from 'drizzle-orm'
import { revalidatePath } from 'next/cache'
import type { GoalType } from '@/lib/goals'
import { GOAL_PRESETS } from '@/lib/goals'
import { computeCurrentValue } from '@/lib/goals-progress'


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

/** Internal — auto-tracking only; UI uses updateCustomGoalProgress */
async function updateGoalProgress(goalId: number, currentValue: number) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const goal = await db.query.goals.findFirst({
    where: and(eq(goals.id, goalId), eq(goals.userId, session.user.id)),
  })
  if (!goal) throw new Error('Goal not found')

  const completed = currentValue >= (goal.targetValue ?? 0)
  // userId asserted in WHERE — prevents TOCTOU between ownership check and update
  await db.update(goals)
    .set({
      currentValue,
      completedAt: completed && !goal.completedAt ? new Date() : goal.completedAt,
    })
    .where(and(eq(goals.id, goalId), eq(goals.userId, session.user.id)))

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
  }).where(and(eq(goals.id, goalId), eq(goals.userId, session.user.id)))

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
