'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { portfolioEvents, repositories, users } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import type { AdvisorAction } from '@/lib/ai/advisor'

export type NexusTaskStatus = 'queued' | 'preparing' | 'ready' | 'failed' | 'unknown'

export interface QueuedTask {
  taskId: string
  status: NexusTaskStatus
  nexusUrl: string
}

function getNexusConfig(): { url: string; token: string } | null {
  const url   = process.env.NEXUS_API_URL?.replace(/\/$/, '')
  const token = process.env.NEXUS_API_TOKEN
  if (!url || !token) return null
  return { url, token }
}

/** Map AdvisorAction impactType + effort → risk tier for Nexus metadata */
function resolveRiskTier(action: AdvisorAction): 'tier1' | 'tier2' | 'tier3' {
  // security is always tier3 if impactType supported it; default based on effort
  if (action.effort === 'quick') return 'tier1'
  return 'tier2'
}

/** Build acceptance criteria from the advisor action */
function buildAcceptanceCriteria(action: AdvisorAction): string[] {
  const criteria: string[] = [`${action.action} — ${action.reasoning}`]
  if (action.impactType === 'security')    criteria.push('No new security alerts introduced')
  if (action.impactType === 'health')      criteria.push('Health score does not decrease')
  if (action.impactType === 'opportunity') criteria.push('Opportunity score improves or stays the same')
  criteria.push('All existing tests continue to pass')
  return criteria
}

export async function queueAdvisorAction(
  action: AdvisorAction,
): Promise<QueuedTask> {
  try {
    return await _queueAdvisorAction(action)
  } catch (err) {
    // Always re-throw as plain serializable Error so Next.js sends it to
    // the client catch block instead of "Server Components render" error
    throw new Error(err instanceof Error ? err.message : `Queue failed: ${String(err)}`)
  }
}

async function _queueAdvisorAction(action: AdvisorAction): Promise<QueuedTask> {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const config = getNexusConfig()
  if (!config) throw new Error('Nexus not configured. Add NEXUS_API_URL and NEXUS_API_TOKEN to your environment.')

  // Look up the repo's full name for Nexus (owner/repo format)
  const repo = await db.query.repositories.findFirst({
    where: and(eq(repositories.id, action.repoId), eq(repositories.userId, session.user.id)),
    columns: { fullName: true, name: true },
  })
  if (!repo) throw new Error(`Repo ${action.repoId} not found`)

  const riskTier  = resolveRiskTier(action)
  const objective = `${action.action}\n\nContext: ${action.reasoning}\nExpected impact: ${action.estimatedImpact}`

  const res = await fetch(`${config.url}/internal/agent-tasks`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${config.token}`,
    },
    body: JSON.stringify({
      objective,
      targetRepository:    repo.fullName,
      executionMode:       action.impactType === 'security' ? 'investigate' : 'fix',
      acceptanceCriteria:  buildAcceptanceCriteria(action),
      contextNotes: JSON.stringify({
        repoHQRepoId:    action.repoId,
        repoHQRepoName:  action.repoName,
        impactType:      action.impactType,
        effort:          action.effort,
        estimatedImpact: action.estimatedImpact,
        riskTier,
        predictedDelta:  action.estimatedImpact,
        source:          'repohq-advisor',
        autoExecute:     true,
      }),
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(`Nexus error: ${err.error?.message ?? res.statusText}`)
  }

  const data = await res.json() as { agentTaskId: string; status: string }

  // Record in portfolio_events so we can track status and accuracy later
  await db.insert(portfolioEvents).values({
    userId:    session.user.id,
    repoId:    action.repoId,
    eventType: 'agent_task_queued',
    title:     `Queued: ${action.action.slice(0, 80)}`,
    description: objective,
    metadata: {
      taskId:          data.agentTaskId,
      nexusStatus:     data.status,
      predictedDelta:  action.estimatedImpact,
      impactType:      action.impactType,
      effort:          action.effort,
      riskTier,
      nexusUrl:        config.url,
    },
  })

  return {
    taskId:   data.agentTaskId,
    status:   (data.status ?? 'queued') as NexusTaskStatus,
    nexusUrl: `${config.url}/learn/review-queue`,
  }
}

export async function getNexusTaskStatus(taskId: string): Promise<NexusTaskStatus> {
  const config = getNexusConfig()
  if (!config) return 'unknown'

  const res = await fetch(`${config.url}/internal/agent-tasks/${taskId}`, {
    headers: { 'Authorization': `Bearer ${config.token}` },
  })

  if (!res.ok) return 'unknown'
  const data = await res.json() as { status?: string }
  return (data.status ?? 'unknown') as NexusTaskStatus
}

export async function isNexusConfigured(): Promise<boolean> {
  return !!getNexusConfig()
}
