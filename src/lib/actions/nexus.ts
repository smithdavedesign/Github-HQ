'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { portfolioEvents, repositories, users } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import type { AdvisorAction, AdvisorContent } from '@/lib/ai/advisor'
import { getRepoLifecycle, BLOCKING_STAGES } from '@/lib/agents/lifecycle'
import type { AccuracyStats } from '@/lib/actions/advisor-accuracy'
import { MIN_DATA_POINTS } from '@/lib/actions/advisor-accuracy-utils'

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

  // Server-side lifecycle guard — prevent duplicate jobs regardless of which UI triggered the queue
  const lifecycle = await getRepoLifecycle(session.user.id, action.repoId)
  if (BLOCKING_STAGES.has(lifecycle.stage)) {
    const detail = lifecycle.prUrl ? ` — PR: ${lifecycle.prUrl}` : ` (stage: ${lifecycle.stage})`
    throw new Error(`An agent task is already active for ${action.repoName}${detail}. Wait for it to complete before queuing another.`)
  }

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
        skillName:       action.impactType === 'security' ? 'investigate' : 'ship',
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

export type GstackSkill = 'investigate' | 'health' | 'ship'

const SKILL_DEFAULTS: Record<GstackSkill, { executionMode: string; acceptanceCriteria: string[] }> = {
  investigate: {
    executionMode: 'investigate',
    acceptanceCriteria: [
      'Root cause identified and documented',
      'Findings listed with file paths and evidence',
      'No new issues introduced',
    ],
  },
  health: {
    executionMode: 'investigate',
    acceptanceCriteria: [
      'Code quality report produced',
      'TypeScript errors, test failures, and dead code listed',
      'Health score computed and findings documented',
    ],
  },
  ship: {
    executionMode: 'fix',
    acceptanceCriteria: [
      'Changes implement the stated objective',
      'All existing tests continue to pass',
      'PR created with clear description',
    ],
  },
}

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

// ─── Session-less queue function (for cron / auto-dispatch) ──────────────────

/**
 * Queues an advisor action for a known userId without requiring a browser session.
 * Safe to call from cron routes — cron auth is verified upstream by verifyCronSecret().
 * Returns null (and logs a warning) on lifecycle blocking or Nexus error rather than throwing.
 */
export async function queueAdvisorActionForUser(
  userId: string,
  action: AdvisorAction,
): Promise<{ taskId: string; nexusUrl: string } | null> {
  const config = getNexusConfig()
  if (!config) return null

  const lifecycle = await getRepoLifecycle(userId, action.repoId)
  if (BLOCKING_STAGES.has(lifecycle.stage)) return null  // task already in flight

  const repo = await db.query.repositories.findFirst({
    where: and(eq(repositories.id, action.repoId), eq(repositories.userId, userId)),
    columns: { fullName: true, name: true },
  })
  if (!repo) return null

  const riskTier  = resolveRiskTier(action)
  const objective = `${action.action}\n\nContext: ${action.reasoning}\nExpected impact: ${action.estimatedImpact}`

  try {
    const res = await fetch(`${config.url}/internal/agent-tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.token}` },
      body: JSON.stringify({
        objective,
        targetRepository:   repo.fullName,
        executionMode:      action.impactType === 'security' ? 'investigate' : 'fix',
        acceptanceCriteria: buildAcceptanceCriteria(action),
        contextNotes: JSON.stringify({
          repoHQRepoId:    action.repoId,
          repoHQRepoName:  action.repoName,
          impactType:      action.impactType,
          effort:          action.effort,
          estimatedImpact: action.estimatedImpact,
          riskTier,
          predictedDelta:  action.estimatedImpact,
          source:          'repohq-auto-dispatch',
          skillName:       action.impactType === 'security' ? 'investigate' : 'ship',
          autoExecute:     action.effort !== 'substantial',
        }),
      }),
    })
    if (!res.ok) {
      console.warn(`[auto-dispatch] Nexus error for ${action.repoName}:`, res.status)
      return null
    }

    const data = await res.json() as { agentTaskId: string; status: string }

    await db.insert(portfolioEvents).values({
      userId,
      repoId:    action.repoId,
      eventType: 'agent_task_queued',
      title:     `Auto-queued: ${action.action.slice(0, 80)}`,
      description: objective,
      metadata: {
        taskId:         data.agentTaskId,
        nexusStatus:    data.status,
        predictedDelta: action.estimatedImpact,
        impactType:     action.impactType,
        effort:         action.effort,
        riskTier,
        nexusUrl:       config.url,
        autoDispatched: true,
      },
    })

    return { taskId: data.agentTaskId, nexusUrl: `${config.url}/learn/review-queue` }
  } catch (err) {
    console.warn('[auto-dispatch] failed to queue:', err instanceof Error ? err.message : err)
    return null
  }
}

export interface AutoDispatchSettings {
  autoDispatchEnabled:           boolean
  autoDispatchEffortGate:        string   // 'quick_only' | 'quick_and_medium' | 'all'
  autoDispatchMaxPerRun:         number
  autoDispatchSkipSecurity:      boolean
  autoDispatchAccuracyThreshold: number   // 0 = off; 50/80 = min success rate
}

/**
 * Runs the auto-dispatch filter logic and queues eligible advisor actions.
 * Called from the digest cron after generateAdvisor() completes.
 */
export async function autoDispatchAdvisorActions(
  userId: string,
  advisor: AdvisorContent,
  settings: AutoDispatchSettings,
  accuracyStats: AccuracyStats[],
): Promise<{ queued: number; skipped: string[]; errors: string[] }> {
  const result = { queued: 0, skipped: [] as string[], errors: [] as string[] }
  if (!advisor.actions?.length) return result

  const config = getNexusConfig()
  if (!config) { result.errors.push('Nexus not configured'); return result }

  for (const action of advisor.actions) {
    if (result.queued >= settings.autoDispatchMaxPerRun) break

    // 1. Effort gate
    if (action.effort === 'substantial' && settings.autoDispatchEffortGate !== 'all') {
      result.skipped.push(`${action.repoName}: substantial effort (gate=${settings.autoDispatchEffortGate})`)
      continue
    }
    if (action.effort === 'medium' && settings.autoDispatchEffortGate === 'quick_only') {
      result.skipped.push(`${action.repoName}: medium effort (gate=quick_only)`)
      continue
    }

    // 2. Security gate
    if (action.impactType === 'security' && settings.autoDispatchSkipSecurity) {
      result.skipped.push(`${action.repoName}: security action (skip_security=true)`)
      continue
    }

    // 3. Accuracy gate (only if threshold > 0 and sufficient data)
    if (settings.autoDispatchAccuracyThreshold > 0) {
      const stat = accuracyStats.find(s => s.impactType === action.impactType)
      const minPts = MIN_DATA_POINTS[action.impactType as keyof typeof MIN_DATA_POINTS] ?? 3
      if (stat && stat.dataPoints >= minPts && stat.successRate < settings.autoDispatchAccuracyThreshold) {
        result.skipped.push(`${action.repoName}: ${action.impactType} accuracy ${stat.successRate}% < threshold ${settings.autoDispatchAccuracyThreshold}%`)
        continue
      }
    }

    // 4. Queue (lifecycle guard handled inside queueAdvisorActionForUser)
    const queued = await queueAdvisorActionForUser(userId, action)
    if (queued) {
      result.queued++
    } else {
      result.skipped.push(`${action.repoName}: lifecycle blocked or error`)
    }
  }

  return result
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
