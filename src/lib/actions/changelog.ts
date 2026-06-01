'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { portfolioEvents } from '@/lib/db/schema'
import { eq, and, desc, gte, lt } from 'drizzle-orm'

export async function getPortfolioEvents(year?: number): Promise<(import('@/lib/db/schema').PortfolioEvent & { repoName?: string | null })[]> {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const conditions = [eq(portfolioEvents.userId, session.user.id)]
  if (year) {
    conditions.push(gte(portfolioEvents.occurredAt, new Date(`${year}-01-01`)))
    conditions.push(lt(portfolioEvents.occurredAt, new Date(`${year + 1}-01-01`)))
  }

  const rows = await db.query.portfolioEvents.findMany({
    where: and(...conditions),
    with: { repository: { columns: { name: true } } },
    orderBy: [desc(portfolioEvents.occurredAt)],
  })

  return rows.map(r => ({ ...r, repoName: r.repository?.name ?? null }))
}

export async function createMilestone(title: string, description?: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  if (!title.trim()) throw new Error('Title required')

  await db.insert(portfolioEvents).values({
    userId: session.user.id,
    eventType: 'manual_milestone',
    title: title.trim(),
    description: description?.trim() || null,
  })
}

export async function deleteEvent(eventId: number) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  // Only allow deleting manual milestones
  await db.delete(portfolioEvents).where(
    and(
      eq(portfolioEvents.id, eventId),
      eq(portfolioEvents.userId, session.user.id),
      eq(portfolioEvents.eventType, 'manual_milestone'),
    )
  )
}
