import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { portfolioEvents, repositories } from '@/lib/db/schema'
import { eq, and, desc } from 'drizzle-orm'
import { after } from 'next/server'
import { dispatchNotification } from '@/lib/notifications/dispatcher'

interface AgentEventPayload {
  eventType: 'agent_task_queued' | 'agent_pr_created' | 'agent_pr_merged' | 'agent_execution_failed'
  taskId:    string
  repoName?: string
  prUrl?:    string
  summary?:  string
  agentName?: string
  durationMs?: number
  filesChanged?: number
  costUsd?: number
}

export async function POST(request: Request) {
  // Validate webhook secret
  const secret = request.headers.get('x-nexus-webhook-secret')
  const expected = process.env.NEXUS_WEBHOOK_SECRET
  if (expected && secret !== expected) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let payload: AgentEventPayload
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { eventType, taskId, repoName, prUrl, summary, agentName, durationMs, filesChanged, costUsd } = payload

  // Find the queued task event to get userId, repoId, and predictedDelta
  const queuedEvent = await db.query.portfolioEvents.findFirst({
    where: and(
      eq(portfolioEvents.eventType, 'agent_task_queued'),
    ),
    orderBy: [desc(portfolioEvents.occurredAt)],
  })

  // Try to match by taskId in metadata
  const allQueued = await db.query.portfolioEvents.findMany({
    where: eq(portfolioEvents.eventType, 'agent_task_queued'),
    orderBy: [desc(portfolioEvents.occurredAt)],
    limit: 50,
  })

  const matched = allQueued.find(e => {
    const meta = e.metadata as { taskId?: string } | null
    return meta?.taskId === taskId
  })

  if (!matched) {
    // Still accept the webhook, just can't correlate accuracy
    return NextResponse.json({ ok: true, correlated: false })
  }

  const userId = matched.userId
  const repoId = matched.repoId
  const meta   = matched.metadata as { predictedDelta?: string; impactType?: string } | null

  if (eventType === 'agent_pr_created') {
    await db.insert(portfolioEvents).values({
      userId,
      repoId,
      eventType: 'agent_pr_created',
      title:    `Agent PR created${repoName ? ` for ${repoName}` : ''}`,
      description: summary ?? null,
      metadata: { taskId, prUrl, agentName, durationMs, filesChanged, costUsd },
    })
    after(async () => {
      await dispatchNotification({
        userId,
        eventType: 'agent_pr_ready',
        title: `Agent PR ready for review${repoName ? ` — ${repoName}` : ''}`,
        body: summary ?? undefined,
        repoId: repoId ?? null,
        metadata: { taskId, prUrl },
      })
    })
  }

  if (eventType === 'agent_pr_merged') {
    // Write the merge event — actual delta will be computed after resync
    await db.insert(portfolioEvents).values({
      userId,
      repoId,
      eventType: 'agent_pr_merged',
      title:    `Agent PR merged${repoName ? ` in ${repoName}` : ''}`,
      description: summary ?? null,
      metadata: {
        taskId,
        prUrl,
        agentName,
        durationMs,
        filesChanged,
        costUsd,
        predictedDelta:  meta?.predictedDelta ?? null,
        impactType:      meta?.impactType ?? null,
        actualDeltaPending: true,   // will be updated after resync
      },
    })

    // Trigger a repo resync after response so we can compute actualDelta
    if (repoId) {
      after(async () => {
        try {
          const repo = await db.query.repositories.findFirst({
            where: eq(repositories.id, repoId),
            columns: { id: true, githubId: true, owner: true, name: true },
          })
          if (!repo) return

          const { users } = await import('@/lib/db/schema')
          const { eq: eqDrizzle } = await import('drizzle-orm')
          const user = await db.query.users.findFirst({
            where: eqDrizzle(users.id, userId),
            columns: { githubToken: true },
          })
          if (!user?.githubToken) return

          const { syncSingleRepo } = await import('@/lib/github/sync')
          const repoStub = { id: repo.githubId, owner: { login: repo.owner }, name: repo.name,
            full_name: `${repo.owner}/${repo.name}`, visibility: 'private', private: true,
            description: null, default_branch: 'main', homepage: null, stargazers_count: 0,
            forks_count: 0, language: null, archived: false, fork: false,
            pushed_at: new Date().toISOString(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
          await syncSingleRepo(userId, user.githubToken, repoStub)
        } catch (err) {
          console.error('[agent-webhook] resync failed:', err)
        }
      })
    }
  }

  if (eventType === 'agent_execution_failed') {
    await db.insert(portfolioEvents).values({
      userId,
      repoId,
      eventType: 'agent_execution_failed',
      title:    `Agent execution failed${repoName ? ` for ${repoName}` : ''}`,
      description: summary ?? null,
      metadata: { taskId, agentName, durationMs },
    })
    after(async () => {
      await dispatchNotification({
        userId,
        eventType: 'agent_failed',
        title: `Agent execution failed${repoName ? ` — ${repoName}` : ''}`,
        body: summary ?? undefined,
        repoId: repoId ?? null,
        metadata: { taskId },
      })
    })
  }

  return NextResponse.json({ ok: true, correlated: true })
}
