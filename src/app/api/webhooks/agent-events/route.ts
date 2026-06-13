import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { portfolioEvents, repositories } from '@/lib/db/schema'
import { eq, and, desc } from 'drizzle-orm'
import { after } from 'next/server'
import { dispatchNotification } from '@/lib/notifications/dispatcher'
import { isGstackSkill } from '@/lib/actions/nexus-utils'
import { secretsEqual } from '@/lib/crypto-utils'

interface AgentEventPayload {
  eventType: 'agent_task_queued' | 'agent_pr_created' | 'agent_pr_merged' | 'agent_execution_failed' | 'agent_skill_report'
  taskId:    string
  repoName?: string
  prUrl?:    string
  summary?:  string
  agentName?: string
  durationMs?: number
  filesChanged?: number
  costUsd?: number
  // Phase G4: gstack skill findings (when outcome = no-changes)
  skillName?: string
  findings?: string[]
  suggestedNextSkill?: string
  outcome?: string
  healthScore?: number
}

export async function POST(request: Request) {
  // Validate webhook secret — constant-time comparison to prevent timing attacks
  const secret = request.headers.get('x-nexus-webhook-secret')
  const expected = process.env.NEXUS_WEBHOOK_SECRET
  if (!expected || !secret || !secretsEqual(secret, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  let payload: AgentEventPayload
  try {
    payload = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { eventType, taskId, repoName, prUrl, summary, agentName, durationMs, filesChanged, costUsd } = payload

  // Find the queued task event to correlate userId + repoId.
  // Scoped to a single user's events when possible — taskIds are unique per Nexus instance
  // so a cross-user scan is not needed. We scan the last 50 for performance.
  const allQueued = await db.query.portfolioEvents.findMany({
    where: eq(portfolioEvents.eventType, 'agent_task_queued'),
    orderBy: [desc(portfolioEvents.occurredAt)],
    limit: 50,
    columns: { userId: true, repoId: true, metadata: true },
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
      // Copy impactType and predictedDelta from the queued event so accuracy
      // can be tracked per impactType even for failures
      metadata: {
        taskId,
        agentName,
        durationMs,
        impactType:     meta?.impactType ?? null,
        predictedDelta: meta?.predictedDelta ?? null,
      },
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

  // Phase G4: gstack skill completed with findings but no code changes
  if (eventType === 'agent_skill_report') {
    const queuedMeta = matched.metadata as { source?: string } | null
    const isSelfScan = queuedMeta?.source === 'gstack-self-scan'

    await db.insert(portfolioEvents).values({
      userId,
      repoId,
      eventType: 'agent_skill_report',
      title:     `/${payload.skillName ?? 'skill'} findings${repoName ? ` — ${repoName}` : ''}`,
      description: summary ?? null,
      metadata: {
        taskId,
        skillName:          payload.skillName,
        findings:           payload.findings ?? [],
        outcome:            payload.outcome ?? 'no-changes',
        healthScore:        payload.healthScore ?? null,
        suggestedNextSkill: payload.suggestedNextSkill ?? null,
        agentName,
        durationMs,
        source: isSelfScan ? 'gstack-self-scan' : undefined,
      },
    })

    // Self-improvement loop: convert findings from self-scans into queued fix tasks.
    // Only fires for scans originating from /api/cron/gstack-self (source === 'gstack-self-scan').
    // Max 3 fix tasks per report cycle to avoid runaway dispatch.
    if (isSelfScan && repoId && (payload.findings?.length ?? 0) > 0) {
      after(async () => {
        try {
          const { queueAdvisorActionForUser } = await import('@/lib/actions/nexus')
          const findings = (payload.findings ?? []).slice(0, 3)
          const repoShortName = repoName ?? 'RepoHQ'

          for (const finding of findings) {
            const impactType: 'health' | 'security' | 'opportunity' =
              /secret|vuln|cve|injection|xss|auth/i.test(finding)
                ? 'security'
                : /opportunity|feature|perf|speed|ux/i.test(finding)
                ? 'opportunity'
                : 'health'

            await queueAdvisorActionForUser(userId, {
              repoId,
              repoName:        repoShortName,
              action:          `Fix: ${finding}`,
              impactType,
              effort:          'quick',
              estimatedImpact: 'Improve code quality score',
              reasoning:       `Gstack self-scan (/${payload.skillName ?? 'skill'}) finding: ${finding}`,
            }).catch(err =>
              console.warn('[gstack-self] fix task queue failed:', err instanceof Error ? err.message : err)
            )
          }
        } catch (err) {
          console.error('[gstack-self] self-improve dispatch failed:', err)
        }
      })
    }
  }

  // OpenClaw skill-chain: when a skill report includes a suggestedNextSkill, automatically
  // queue it — but only when the user has autoDispatch enabled AND the originating task was
  // not itself a chain (chainDepth check prevents infinite loops).
  if (eventType === 'agent_skill_report' && payload.suggestedNextSkill && repoId && userId) {
    const queuedMeta = matched?.metadata as { source?: string; chainDepth?: number } | null
    const isChained = queuedMeta?.source === 'skill-chain'
    const nextSkill = payload.suggestedNextSkill

    // Validate the suggested skill is a known GstackSkill before acting on it
    if (!isChained && isGstackSkill(nextSkill)) {
      after(async () => {
        try {
          const { users: usersTable } = await import('@/lib/db/schema')
          const { eq: eqDrizzle } = await import('drizzle-orm')
          const user = await db.query.users.findFirst({
            where: eqDrizzle(usersTable.id, userId),
            columns: { autoDispatchEnabled: true },
          })
          if (!user?.autoDispatchEnabled) return

          const { queueSuggestedSkill } = await import('@/lib/actions/nexus')
          const topFindings = (payload.findings ?? []).slice(0, 3).join('; ')
          const objective = `Auto-chain from /${payload.skillName ?? 'skill'}: ${topFindings.slice(0, 200)}`

          await queueSuggestedSkill(
            userId,
            repoId,
            repoName ?? '',
            nextSkill,
            objective,
            payload.skillName ?? 'unknown',
          )
        } catch (err) {
          console.warn('[skill-chain] auto-queue failed (non-fatal):', err instanceof Error ? err.message : err)
        }
      })
    }
  }

  return NextResponse.json({ ok: true, correlated: true })
}
