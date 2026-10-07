import 'server-only'

/**
 * RepoHQ's side of the Agent HQ queue (roadmap Phase 81, docs/agent-hq-migration-prd.md §6–§8).
 * Everything that asks an agent to work — Run agent, the gstack launcher, Monday auto-dispatch,
 * the weekly health/retro runs — writes an `agent_requests` row (the truth) plus its
 * `agent_task_queued` event, then adds a BullMQ job (transport) for the factory worker on the
 * owner's Mac. RepoHQ never runs an agent itself, and the factory is the only thing that writes code.
 *
 * Session-less: these take an explicit userId (cron routes, internal callers), so this module is
 * server-only and never a 'use server' file. Browser actions live in src/lib/actions/agent-queue.ts.
 */
import { randomUUID } from 'node:crypto'
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '@/lib/db'
import { agentRequests, portfolioEvents, repositories } from '@/lib/db/schema'
import type { AdvisorAction, AdvisorContent } from '@/lib/ai/advisor'
import { getRepoLifecycle, BLOCKING_STAGES } from '@/lib/agents/lifecycle'
import type { AccuracyStats } from '@/lib/actions/advisor-accuracy'
import { MIN_DATA_POINTS } from '@/lib/actions/advisor-accuracy-utils'
import {
  isAllowlisted, modeForSkill, newRequestRow, queuedEventValues, type NewRequest, type RequestSource,
} from '@/lib/agents/factory-request-utils'
import {
  resolveAdvisorSkill,
  parseRepoSkillAllowlist,
  parseEnvSkillAllowlistMap,
  isSkillAllowedForRepo,
  resolveSkillPolicyTier,
  resolveConfidenceBand,
  isTierAllowedForLifecycle,
  isTierAllowedByConfidence,
  parseEnvHighRiskOptInMap,
  isTierAllowedByProgressiveAutonomy,
  type GstackSkill,
} from '@/lib/skills/skill-policy'
import factoryConfig from '../../../factory/factory.config.json'
import { requestJobOptions, withQueue } from '../../../factory/lib/queue'

/** Where the Agents page lives; queue results link here. */
export const AGENTS_PAGE = '/agent-performance'

/** The factory's allowlist (factory/factory.config.json `repos`): the only repos it will touch. */
export function factoryAllowlist(): readonly string[] {
  return factoryConfig.repos
}

/** The one user the factory works for (FACTORY_USER_ID, the same id as in ~/.repohq-factory/env). */
export function factoryOwnerId(): string | null {
  return process.env.FACTORY_USER_ID || null
}

export type Access = { ok: true } | { ok: false; reason: string }

/** The user's repos the factory takes requests for (none unless the user is the factory owner). */
export async function factoryRepoIdsFor(userId: string): Promise<number[]> {
  if (!factoryAccess(userId).ok) return []
  const rows = await db.query.repositories.findMany({
    where: eq(repositories.userId, userId),
    columns: { id: true, fullName: true },
  })
  return rows.filter(r => isAllowlisted(r.fullName, factoryAllowlist())).map(r => r.id)
}

/** May this user queue factory work (on this repo)? The reason is what the UI shows when not. */
export function factoryAccess(userId: string, repoFullName?: string): Access {
  const owner = factoryOwnerId()
  if (!owner) return { ok: false, reason: 'The factory is not set up for this deployment (FACTORY_USER_ID is not set).' }
  if (owner !== userId) return { ok: false, reason: 'The factory runs agents for its owner only.' }
  if (repoFullName && !isAllowlisted(repoFullName, factoryAllowlist())) {
    return { ok: false, reason: `${repoFullName} is not on the factory allowlist (factory/factory.config.json "repos").` }
  }
  return { ok: true }
}

/** Map AdvisorAction effort → risk tier, kept in the queued event for the accuracy views. */
export function resolveRiskTier(action: AdvisorAction): 'tier1' | 'tier2' | 'tier3' {
  if (action.effort === 'quick') return 'tier1'
  return 'tier2'
}

/** "Done when" lines for an advisor action, folded into the objective the factory works from. */
export function buildAcceptanceCriteria(action: AdvisorAction): string[] {
  const criteria: string[] = [`${action.action} — ${action.reasoning}`]
  if (action.impactType === 'security')    criteria.push('No new security alerts introduced')
  if (action.impactType === 'health')      criteria.push('Health score does not decrease')
  if (action.impactType === 'opportunity') criteria.push('Opportunity score improves or stays the same')
  criteria.push('All existing tests continue to pass')
  return criteria
}

export function advisorObjective(action: AdvisorAction): string {
  return [
    action.action,
    '',
    `Context: ${action.reasoning}`,
    `Expected impact: ${action.estimatedImpact}`,
    '',
    'Done when:',
    ...buildAcceptanceCriteria(action).map(c => `- ${c}`),
  ].join('\n')
}

export type QueueResult = { ok: true; taskId: string; inRedis: boolean } | { ok: false; reason: string }

interface EnqueueInput {
  userId: string
  repoId: number
  skill: GstackSkill
  objective: string
  source: RequestSource
  /** Feed / Agent tab title for the queued event. */
  title: string
  /** Extra metadata for the queued event (advisor context the accuracy loop reads). */
  extra?: Record<string, unknown>
  /** Skip the per-repo skill allowlist (explicit owner choice from the launcher). */
  skipSkillPolicy?: boolean
}

/**
 * The single way work reaches the factory: guards (owner, allowlist, one open request per repo,
 * repo skill policy), then the row + queued event in one batch, then the BullMQ job (best effort:
 * without Redis the worker re-queues the row at its next cycle).
 */
export async function enqueueRequest(input: EnqueueInput): Promise<QueueResult> {
  const repo = await db.query.repositories.findFirst({
    where: and(eq(repositories.id, input.repoId), eq(repositories.userId, input.userId)),
    columns: { fullName: true, name: true, tags: true },
  })
  if (!repo) return { ok: false, reason: `Repo ${input.repoId} not found` }

  const access = factoryAccess(input.userId, repo.fullName)
  if (!access.ok) return access

  const mode = modeForSkill(input.skill)
  if (!mode) return { ok: false, reason: `/${input.skill} has no factory equivalent (it needs a browser and live network access the sandbox doesn't have).` }

  if (!input.skipSkillPolicy) {
    const allowed = isSkillAllowedForRepo(input.skill, repo.fullName, parseRepoSkillAllowlist(repo.tags), parseEnvSkillAllowlistMap(process.env.REPO_GSTACK_SKILL_ALLOWLIST_JSON))
    if (!allowed) {
      return { ok: false, reason: `Repo policy blocks /${input.skill} for ${repo.fullName}. Add tag gstack-allow:${input.skill} (or set REPO_GSTACK_SKILL_ALLOWLIST_JSON) to allow it.` }
    }
  }

  // Server-side lifecycle guard: one open request (or open agent PR) per repo, whatever the caller.
  const lifecycle = await getRepoLifecycle(input.userId, input.repoId)
  if (BLOCKING_STAGES.has(lifecycle.stage)) {
    const detail = lifecycle.prUrl ? ` — PR: ${lifecycle.prUrl}` : ` (stage: ${lifecycle.stage})`
    return { ok: false, reason: `An agent task is already active for ${repo.name}${detail}. Wait for it to finish (or cancel it on the Agents page).` }
  }

  const request: NewRequest = {
    id: randomUUID(), userId: input.userId, repoId: input.repoId, repo: repo.fullName, mode, skill: input.skill,
    objective: input.objective, source: input.source, now: new Date(),
  }
  await db.batch([
    db.insert(agentRequests).values(newRequestRow(request)),
    db.insert(portfolioEvents).values(queuedEventValues(request, input.title, input.extra)),
  ])
  return { ok: true, taskId: request.id, inRedis: await addRequestJob(request.id) }
}

/** Add (or re-add) a request's BullMQ job. Never throws: Neon already holds the request. */
export async function addRequestJob(requestId: string, delayMs = 0): Promise<boolean> {
  const url = process.env.REDIS_URL
  if (!url) return false
  try {
    await withQueue(url, q => q.add('request', { requestId }, requestJobOptions(requestId, delayMs)))
    return true
  } catch (err) {
    console.warn('[factory-queue] Redis enqueue failed — the worker re-queues it from Neon:', err instanceof Error ? err.message : err)
    return false
  }
}

/** Queue an advisor action ("Run agent", Monday auto-dispatch). Security actions come back as an investigation report. */
export async function queueAdvisorActionForUser(userId: string, action: AdvisorAction, source: RequestSource = 'auto-dispatch'): Promise<QueueResult> {
  const riskTier = resolveRiskTier(action)
  return enqueueRequest({
    userId,
    repoId: action.repoId,
    skill: resolveAdvisorSkill(action.impactType),
    objective: advisorObjective(action),
    source,
    title: `${source === 'auto-dispatch' ? 'Auto-queued' : 'Queued'}: ${action.action.slice(0, 80)}`,
    extra: {
      impactType: action.impactType,
      effort: action.effort,
      estimatedImpact: action.estimatedImpact,
      predictedDelta: action.estimatedImpact,
      riskTier,
      ...(source === 'auto-dispatch' ? { autoDispatched: true } : {}),
    },
  })
}

/** Queue a gstack skill on a repo (the launcher, the findings preview, the weekly health/retro runs). */
export async function queueSkillForUser(
  userId: string, repoId: number, skill: GstackSkill, objective: string, source: RequestSource,
): Promise<QueueResult> {
  return enqueueRequest({
    userId, repoId, skill, objective, source,
    title: `gstack /${skill}: ${objective.slice(0, 80)}`,
    // The owner picked this skill explicitly in the launcher; scheduled runs still honour repo policy.
    skipSkillPolicy: source === 'ui-skill',
  })
}

export interface AutoDispatchSettings {
  autoDispatchEnabled:           boolean
  autoDispatchEffortGate:        string   // 'quick_only' | 'quick_and_medium' | 'all'
  autoDispatchMaxPerRun:         number
  autoDispatchSkipSecurity:      boolean
  autoDispatchAccuracyThreshold: number   // 0 = off; 50/80 = min success rate
}

/**
 * Runs the auto-dispatch filter logic and queues eligible advisor actions into the factory.
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

  const access = factoryAccess(userId)
  if (!access.ok) { result.errors.push(access.reason); return result }

  const repoIds = Array.from(new Set(advisor.actions.map((a) => a.repoId)))
  const repoRows = repoIds.length > 0
    ? await db.query.repositories.findMany({
      where: and(eq(repositories.userId, userId), inArray(repositories.id, repoIds)),
      columns: { id: true, fullName: true, tags: true, lifecycleStatus: true },
    })
    : []
  const repoById = new Map(repoRows.map(r => [r.id, r]))

  const highRiskOptInMap = parseEnvHighRiskOptInMap(process.env.REPO_GSTACK_HIGH_RISK_OPT_IN_JSON)

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

    // 3. Skill policy tier gate (lifecycle + confidence)
    const skill = resolveAdvisorSkill(action.impactType)
    const tier = resolveSkillPolicyTier(skill, action.impactType)
    const repoInfo = repoById.get(action.repoId)
    const lifecycleStatus = repoInfo?.lifecycleStatus ?? null
    const repoFullName = repoInfo?.fullName ?? action.repoName

    if (!isTierAllowedForLifecycle(tier, lifecycleStatus)) {
      result.skipped.push(`${action.repoName}: /${skill} (${tier}) blocked for lifecycle ${lifecycleStatus ?? 'unknown'}`)
      continue
    }

    if (!isTierAllowedByProgressiveAutonomy(tier, repoFullName, repoInfo?.tags ?? null, highRiskOptInMap)) {
      result.skipped.push(`${action.repoName}: /${skill} (${tier}) blocked until repo opts in to high-risk auto-run`)
      continue
    }

    const stat = accuracyStats.find(s => s.impactType === action.impactType)
    const minPts = MIN_DATA_POINTS[action.impactType as keyof typeof MIN_DATA_POINTS] ?? 3
    const confidence = stat ? resolveConfidenceBand(stat.successRate, stat.dataPoints, minPts) : 'low'

    if (!isTierAllowedByConfidence(tier, confidence)) {
      result.skipped.push(`${action.repoName}: /${skill} (${tier}) blocked by ${confidence}-confidence ${action.impactType} signal`)
      continue
    }

    // 4. Accuracy threshold gate (only if threshold > 0 and sufficient data)
    if (settings.autoDispatchAccuracyThreshold > 0) {
      if (stat && stat.dataPoints >= minPts && stat.successRate < settings.autoDispatchAccuracyThreshold) {
        result.skipped.push(`${action.repoName}: ${action.impactType} accuracy ${stat.successRate}% < threshold ${settings.autoDispatchAccuracyThreshold}%`)
        continue
      }
    }

    // 5. Queue (allowlist, lifecycle and repo skill policy are checked inside)
    const queued = await queueAdvisorActionForUser(userId, action, 'auto-dispatch')
    if (queued.ok) result.queued++
    else result.skipped.push(`${action.repoName}: ${queued.reason}`)
  }

  return result
}
