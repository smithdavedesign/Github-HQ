'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { portfolioEvents, repositories } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import type { AdvisorAction } from '@/lib/ai/advisor'
import { getRepoLifecycle, BLOCKING_STAGES } from '@/lib/agents/lifecycle'
import { getNexusConfig, resolveRiskTier, buildAcceptanceCriteria, SKILL_DEFAULTS } from '@/lib/agents/nexus-dispatch'
import type { GstackSkill } from './nexus-utils'
import {
  resolveAdvisorSkill,
  parseRepoSkillAllowlist,
  parseEnvSkillAllowlistMap,
  isSkillAllowedForRepo,
} from './nexus-utils'

// Browser-facing actions only: each derives the user from the session. Session-less dispatch
// (cron, webhooks, CI checker) is in src/lib/agents/nexus-dispatch.ts.

export type NexusTaskStatus = 'queued' | 'preparing' | 'ready' | 'failed' | 'unknown'

export interface QueuedTask {
  taskId: string
  status: NexusTaskStatus
  nexusUrl: string
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

  // Server-side lifecycle guard — prevent duplicate jobs regardless of which UI triggered the queue
  const lifecycle = await getRepoLifecycle(session.user.id, action.repoId)
  if (BLOCKING_STAGES.has(lifecycle.stage)) {
    const detail = lifecycle.prUrl ? ` — PR: ${lifecycle.prUrl}` : ` (stage: ${lifecycle.stage})`
    throw new Error(`An agent task is already active for ${action.repoName}${detail}. Wait for it to complete before queuing another.`)
  }

  // Look up the repo's full name for Nexus (owner/repo format)
  const repo = await db.query.repositories.findFirst({
    where: and(eq(repositories.id, action.repoId), eq(repositories.userId, session.user.id)),
    columns: { fullName: true, name: true, tags: true },
  })
  if (!repo) throw new Error(`Repo ${action.repoId} not found`)

  const advisorSkill = resolveAdvisorSkill(action.impactType)
  const envAllowlistMap = parseEnvSkillAllowlistMap(process.env.REPO_GSTACK_SKILL_ALLOWLIST_JSON)
  const repoTagAllowlist = parseRepoSkillAllowlist(repo.tags)
  const allowed = isSkillAllowedForRepo(advisorSkill, repo.fullName, repoTagAllowlist, envAllowlistMap)
  if (!allowed) {
    throw new Error(`Repo policy blocks /${advisorSkill} for ${repo.fullName}. Add tag gstack-allow:${advisorSkill} (or set REPO_GSTACK_SKILL_ALLOWLIST_JSON) to allow advisor dispatch.`)
  }

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
        skillName:       advisorSkill,
        autoExecute:     action.effort !== 'substantial', // tier3/substantial tasks queue for manual review
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

// ─── Ad-hoc gstack skill queueing (user + AI agent triggered) ────────────────

export type { GstackSkill } from './nexus-utils'
// Note: SKILL_META cannot be re-exported from 'use server' files — import directly from './nexus-utils'

/**
 * Queues an ad-hoc gstack skill on a repo — triggered by the user from the
 * repo Agent tab or by an AI agent via the queue_gstack_skill MCP tool.
 * Bypasses the AdvisorAction requirement; accepts a free-form objective.
 */
export async function queueGstackSkill(
  repoId: number,
  skill: GstackSkill,
  objective: string,
): Promise<QueuedTask> {
  try {
    return await _queueGstackSkill(repoId, skill, objective)
  } catch (err) {
    throw new Error(err instanceof Error ? err.message : `Queue failed: ${String(err)}`)
  }
}

async function _queueGstackSkill(repoId: number, skill: GstackSkill, objective: string): Promise<QueuedTask> {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const config = getNexusConfig()
  if (!config) throw new Error('Nexus not configured.')

  const lifecycle = await getRepoLifecycle(session.user.id, repoId)
  if (BLOCKING_STAGES.has(lifecycle.stage)) {
    throw new Error(`An agent task is already active for this repo (${lifecycle.stage}). Wait for it to complete.`)
  }

  const repo = await db.query.repositories.findFirst({
    where: and(eq(repositories.id, repoId), eq(repositories.userId, session.user.id)),
    columns: { fullName: true, name: true },
  })
  if (!repo) throw new Error(`Repo ${repoId} not found`)

  const defaults = SKILL_DEFAULTS[skill]
  const riskTier = skill === 'ship' ? 'tier2' : 'tier3'

  const res = await fetch(`${config.url}/internal/agent-tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.token}` },
    body: JSON.stringify({
      objective,
      targetRepository:  repo.fullName,
      executionMode:     defaults.executionMode,
      acceptanceCriteria: defaults.acceptanceCriteria,
      contextNotes: JSON.stringify({
        repoHQRepoId:   repoId,
        repoHQRepoName: repo.name,
        skillName:      skill,
        riskTier,
        source:         'repohq-gstack-ui',
        autoExecute:    true,
      }),
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
    throw new Error(`Nexus error: ${err.error?.message ?? res.statusText}`)
  }

  const data = await res.json() as { agentTaskId: string; status: string }

  await db.insert(portfolioEvents).values({
    userId:    session.user.id,
    repoId,
    eventType: 'agent_task_queued',
    title:     `gstack /${skill}: ${objective.slice(0, 80)}`,
    description: objective,
    metadata: {
      taskId:    data.agentTaskId,
      skillName: skill,
      source:    'repohq-gstack-ui',
      riskTier,
      nexusUrl:  config.url,
    },
  })

  return {
    taskId:   data.agentTaskId,
    status:   (data.status ?? 'queued') as NexusTaskStatus,
    nexusUrl: `${config.url}/learn/review-queue`,
  }
}
