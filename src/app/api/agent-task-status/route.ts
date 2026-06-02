import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { portfolioEvents } from '@/lib/db/schema'
import { eq, and, inArray, desc } from 'drizzle-orm'

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const taskId = url.searchParams.get('taskId')
  if (!taskId) return NextResponse.json({ error: 'taskId required' }, { status: 400 })

  // Find the most recent event for this taskId
  const events = await db.query.portfolioEvents.findMany({
    where: and(
      eq(portfolioEvents.userId, session.user.id),
      inArray(portfolioEvents.eventType, ['agent_task_queued', 'agent_pr_created', 'agent_pr_merged', 'agent_execution_failed']),
    ),
    orderBy: [desc(portfolioEvents.occurredAt)],
    limit: 20,
  })

  const matching = events.filter(e => {
    const meta = e.metadata as { taskId?: string } | null
    return meta?.taskId === taskId
  })

  if (matching.length === 0) return NextResponse.json({ status: 'queued' })

  // Find highest-priority event
  const prMerged  = matching.find(e => e.eventType === 'agent_pr_merged')
  const prCreated = matching.find(e => e.eventType === 'agent_pr_created')
  const failed    = matching.find(e => e.eventType === 'agent_execution_failed')

  if (prMerged) {
    const meta = prMerged.metadata as { prUrl?: string } | null
    return NextResponse.json({ status: 'merged', prUrl: meta?.prUrl ?? null })
  }
  if (prCreated) {
    const meta = prCreated.metadata as { prUrl?: string } | null
    return NextResponse.json({ status: 'pr_ready', prUrl: meta?.prUrl ?? null })
  }
  if (failed) {
    return NextResponse.json({ status: 'failed' })
  }

  return NextResponse.json({ status: 'running' })
}
