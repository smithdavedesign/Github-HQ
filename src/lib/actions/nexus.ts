'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { portfolioEvents, repositories, users } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import type { AdvisorAction, AdvisorContent } from '@/lib/ai/advisor'
import { getRepoLifecycle, BLOCKING_STAGES } from '@/lib/agents/lifecycle'
import type { AccuracyStats } from '@/lib/actions/advisor-accuracy'
import { MIN_DATA_POINTS } from '@/lib/actions/advisor-accuracy-utils'
import type { GstackSkill } from './nexus-utils'

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

export type { GstackSkill } from './nexus-utils'
// Note: SKILL_META cannot be re-exported from 'use server' files — import directly from './nexus-utils'

const SKILL_DEFAULTS: Record<GstackSkill, { executionMode: string; acceptanceCriteria: string[] }> = {
  investigate:        { executionMode: 'investigate', acceptanceCriteria: ['Root cause identified and documented', 'Findings listed with file paths and evidence', 'No new issues introduced'] },
  review:             { executionMode: 'investigate', acceptanceCriteria: ['Code review findings documented', 'Security and logic issues identified', 'No code changes made'] },
  'qa-only':          { executionMode: 'investigate', acceptanceCriteria: ['Bugs found and documented with repro steps', 'No code changes made', 'Health score computed'] },
  qa:                 { executionMode: 'fix',         acceptanceCriteria: ['Bugs found and fixed', 'All existing tests continue to pass', 'Fix commits created'] },
  ship:               { executionMode: 'fix',         acceptanceCriteria: ['Changes implement the stated objective', 'All existing tests continue to pass', 'PR created with clear description'] },
  'document-release': { executionMode: 'fix',         acceptanceCriteria: ['README and docs updated to match shipped code', 'CHANGELOG updated', 'No functional code changes'] },
  health:             { executionMode: 'investigate', acceptanceCriteria: ['Code quality report produced', 'TypeScript errors, test failures, and dead code listed', 'Health score computed'] },
  canary:             { executionMode: 'investigate', acceptanceCriteria: ['Live app checked for console errors and performance issues', 'Baseline comparisons noted', 'No code changes made'] },
  retro:              { executionMode: 'investigate', acceptanceCriteria: ['Weekly commit patterns analysed', 'Engineering highlights and growth areas noted', 'No code changes made'] },
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

/**
 * Queues a gstack skill scan (health, qa-only) targeting a specific repo.
 * Used by the self-improvement cron — bypasses the advisor flow.
 * Returns the taskId or null if Nexus is not configured / lifecycle blocked.
 */
/**
 * Queues the next skill suggested by a completed skill report — called from the
 * agent_skill_report webhook handler after() block.
 * Session-less: accepts explicit userId + repoFullName so it works outside a browser request.
 * Tags contextNotes with source:'skill-chain' and chainDepth:1 so the webhook handler
 * can detect and refuse to chain again (prevents infinite loops).
 * Returns the taskId on success, null on lifecycle block or Nexus error.
 */
export async function queueSuggestedSkill(
  userId: string,
  repoId: number,
  repoFullName: string,
  skill: GstackSkill,
  objective: string,
  parentSkill: string,
): Promise<string | null> {
  if (!userId || !repoId || !repoFullName) return null  // caller safety — webhook repoName can be undefined

  const config = getNexusConfig()
  if (!config) return null

  const lifecycle = await getRepoLifecycle(userId, repoId)
  if (BLOCKING_STAGES.has(lifecycle.stage)) return null

  const defaults = SKILL_DEFAULTS[skill]
  const riskTier = skill === 'ship' ? 'tier2' : 'tier3'

  try {
    const res = await fetch(`${config.url}/internal/agent-tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.token}` },
      body: JSON.stringify({
        objective,
        targetRepository:   repoFullName,
        executionMode:      defaults.executionMode,
        acceptanceCriteria: defaults.acceptanceCriteria,
        contextNotes: JSON.stringify({
          repoHQRepoId:   repoId,
          repoHQRepoName: repoFullName.split('/').pop() ?? repoFullName,
          skillName:      skill,
          riskTier,
          source:         'skill-chain',
          chainDepth:     1,
          parentSkill,
          autoExecute:    true,
        }),
      }),
    })

    if (!res.ok) {
      console.warn(`[skill-chain] Nexus error for ${skill} on ${repoFullName}:`, res.status)
      return null
    }

    const data = await res.json() as { agentTaskId: string }

    await db.insert(portfolioEvents).values({
      userId,
      repoId,
      eventType: 'agent_task_queued',
      title:     `Auto-chain queued: /${skill} on ${repoFullName.split('/').pop()} (from /${parentSkill})`,
      description: objective,
      metadata: {
        taskId:     data.agentTaskId,
        skillName:  skill,
        source:     'skill-chain',
        chainDepth: 1,
        parentSkill,
        riskTier,
        nexusUrl:   config.url,
        autoExecute: true,
      },
    })

    return data.agentTaskId
  } catch (err) {
    console.warn('[skill-chain] failed to queue suggested skill:', err instanceof Error ? err.message : err)
    return null
  }
}

export async function queueGstackSelfScan(
  userId: string,
  repoId: number,
  repoFullName: string,
  skill: 'health' | 'qa-only',
): Promise<string | null> {
  const config = getNexusConfig()
  if (!config) return null

  const lifecycle = await getRepoLifecycle(userId, repoId)
  if (BLOCKING_STAGES.has(lifecycle.stage)) return null

  const objective =
    skill === 'health'
      ? `Run /health on ${repoFullName}: compute code quality score, flag test coverage gaps, type errors, dead code, and linter violations.`
      : `Run /qa-only on ${repoFullName}: systematically test the web application and produce a structured bug report with repro steps and severity.`

  try {
    const res = await fetch(`${config.url}/internal/agent-tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.token}` },
      body: JSON.stringify({
        objective,
        targetRepository:   repoFullName,
        executionMode:      'investigate',
        acceptanceCriteria: [
          `Produce a structured ${skill} report with findings and severity`,
          'Post results back via agent_skill_report webhook event',
        ],
        contextNotes: JSON.stringify({
          repoHQRepoId:   repoId,
          repoHQRepoName: repoFullName.split('/').pop() ?? repoFullName,
          skillName:      skill,
          source:         'gstack-self-scan',
          autoExecute:    true,
        }),
      }),
    })

    if (!res.ok) {
      console.warn(`[gstack-self] Nexus error for ${skill} on ${repoFullName}:`, res.status)
      return null
    }

    const data = await res.json() as { agentTaskId: string }

    await db.insert(portfolioEvents).values({
      userId,
      repoId,
      eventType: 'agent_task_queued',
      title:     `Self-scan queued: /${skill} on ${repoFullName.split('/').pop()}`,
      description: objective,
      metadata: {
        taskId:      data.agentTaskId,
        skillName:   skill,
        source:      'gstack-self-scan',
        nexusUrl:    config.url,
        autoExecute: true,
      },
    })

    return data.agentTaskId
  } catch (err) {
    console.warn('[gstack-self] failed to queue scan:', err instanceof Error ? err.message : err)
    return null
  }
}

