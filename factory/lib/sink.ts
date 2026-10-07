import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { and, eq, gte, ilike, inArray, sql } from 'drizzle-orm'
import * as schema from '../../src/lib/db/schema'
import { factoryActivity } from '../../src/lib/agents/factory-activity'
import type { FactoryActivity } from '../../src/lib/health/freshness'
import type { FactoryConfig } from './config'
import type { AttemptEntry } from './ledger'
import type { RequestHealth } from './system-health'
import { PIPELINES, type TaskKind } from './tasks'

/**
 * Optional mirror of factory activity into RepoHQ (same direct-to-Neon pattern
 * as mcp/server.ts). Enabled only when FACTORY_DATABASE_URL and FACTORY_USER_ID
 * are set. Never throws — the local ledger stays the source of truth.
 *
 * Attempts are written as `agent_attempt` events (repo Agent tab, dead-end
 * detection, attempt distiller). Only Agent HQ requests write `agent_pr_created` /
 * `agent_skill_report` (factory/lib/agent-requests.ts): those events carry the request
 * id that RepoHQ's lifecycle, CI checker and advisor accuracy key on. PRs the factory
 * picked itself have no request and stay `agent_attempt`-only.
 */

type Db = ReturnType<typeof drizzle<typeof schema>>
let cached: Db | null = null

function db(cfg: FactoryConfig): Db | null {
  if (!cfg.repohq.databaseUrl || !cfg.repohq.userId) return null
  cached ??= drizzle(neon(cfg.repohq.databaseUrl), { schema })
  return cached
}

/** The RepoHQ connection for factory modules that write Agent HQ state (requests, runs, traces). */
export function sinkDb(cfg: FactoryConfig): Db | null {
  return db(cfg)
}

export async function repoIdFor(d: Db, userId: string, fullName: string): Promise<number | null> {
  const repo = await d.query.repositories.findFirst({
    where: and(eq(schema.repositories.userId, userId), ilike(schema.repositories.fullName, fullName)),
    columns: { id: true },
  })
  return repo?.id ?? null
}

export async function safely(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    console.warn(`[factory sink] ${label} failed:`, err instanceof Error ? err.message : err)
  }
}

/** RepoHQ health score per repo (lower-cased full name) for opportunity ranking; empty without the sink. */
export async function healthScores(cfg: FactoryConfig): Promise<Map<string, number>> {
  const d = db(cfg)
  const out = new Map<string, number>()
  if (!d) return out
  await safely('healthScores', async () => {
    const rows = await d.select({ fullName: schema.repositories.fullName, health: schema.repositoryMetrics.healthScore })
      .from(schema.repositories)
      .innerJoin(schema.repositoryMetrics, eq(schema.repositoryMetrics.repoId, schema.repositories.id))
      .where(eq(schema.repositories.userId, cfg.repohq.userId!))
    for (const r of rows) if (r.health != null) out.set(r.fullName.toLowerCase(), r.health)
  })
  return out
}

/** Newest RepoHQ health snapshot date (YYYY-MM-DD) for the owner's repos; null without the sink or data. */
export async function latestHealthSnapshot(cfg: FactoryConfig): Promise<string | null> {
  const d = db(cfg)
  if (!d) return null
  let out: string | null = null
  await safely('latestHealthSnapshot', async () => {
    const [row] = await d.select({ latest: sql<string | null>`max(${schema.healthScoreHistory.recordedDate})::text` })
      .from(schema.healthScoreHistory)
      .innerJoin(schema.repositories, eq(schema.healthScoreHistory.repoId, schema.repositories.id))
      .where(eq(schema.repositories.userId, cfg.repohq.userId!))
    out = row?.latest ?? null
  })
  return out
}

/** The idle-factory check for the morning report: the same rule as the dashboard banner. Null without the sink. */
export async function factoryActivityOf(cfg: FactoryConfig): Promise<FactoryActivity | null> {
  const d = db(cfg)
  if (!d) return null
  let out: FactoryActivity | null = null
  await safely('factoryActivity', async () => { out = await factoryActivity(d, cfg.repohq.userId!) })
  return out
}

/**
 * Agent HQ request outcomes (roadmap Phase 81) for the morning report: requests resolved since
 * `since` by status, and the ones still waiting with the oldest one's age. Null without the sink.
 */
export async function requestOutcomes(cfg: FactoryConfig, since: Date, now: Date): Promise<RequestHealth | null> {
  const d = db(cfg)
  if (!d) return null
  let out: RequestHealth | null = null
  await safely('requestOutcomes', async () => {
    const userId = cfg.repohq.userId!
    const [resolved, [waiting]] = await Promise.all([
      d.select({ status: schema.agentRequests.status, n: sql<number>`count(*)::int` })
        .from(schema.agentRequests)
        // gte, not raw sql: the column encodes `since` as UTC (a bare Date param goes out in local time).
        .where(and(eq(schema.agentRequests.userId, userId), gte(schema.agentRequests.resolvedAt, since)))
        .groupBy(schema.agentRequests.status),
      // mapWith: neon-http returns `timestamp` as zone-less text; the column's mapper reads it as UTC.
      d.select({ n: sql<number>`count(*)::int`, oldest: sql<Date | null>`min(${schema.agentRequests.createdAt})`.mapWith(schema.agentRequests.createdAt) })
        .from(schema.agentRequests)
        .where(and(eq(schema.agentRequests.userId, userId), inArray(schema.agentRequests.status, ['queued', 'running']))),
    ])
    const oldest = waiting?.oldest ? new Date(waiting.oldest) : null
    out = {
      resolved: Object.fromEntries(resolved.map(r => [r.status, r.n])),
      waiting: waiting?.n ?? 0,
      oldestWaitingHours: oldest ? Math.floor((now.getTime() - oldest.getTime()) / 3_600_000) : null,
    }
  })
  return out
}

export function attemptEventValues(a: AttemptEntry, userId: string, repoId: number | null, objective: string) {
  const outcome = a.outcome === 'verified' ? 'success' : 'failed'
  const emoji = outcome === 'success' ? '✅' : '❌'
  return {
    userId,
    repoId,
    eventType: 'agent_attempt',
    title: `${emoji} Factory ${a.tier}: ${objective.slice(0, 70)}${objective.length > 70 ? '…' : ''}`,
    description: a.reason,
    dedupKey: `factory:${a.id}`,
    metadata: {
      action: objective,
      outcome,
      reason: a.reason,
      agent: `RepoHQ Factory (${a.tier} · ${a.harness} · ${a.model})`,
      source: 'factory',
      tier: a.tier,
      model: a.model,
      harness: a.harness,
      kind: a.kind,
      exploring: a.exploring,
      isolation: a.isolation ?? 'host',
      requests: a.requests ?? null,
      parentId: a.parentId ?? null,
      reported: a.reported ?? false,
      adversaryModel: a.adversary?.model ?? null,
      adversaryVerdict: a.adversary?.verdict ?? null,
      prUrl: a.prUrl ?? null,
      costUsd: a.costUsd,
      durationMs: a.durationMs,
      loggedAt: a.at,
    },
  }
}

export async function recordAttempt(cfg: FactoryConfig, a: AttemptEntry, objective: string): Promise<void> {
  const d = db(cfg)
  if (!d || a.outcome === 'rate_limited') return
  await safely('recordAttempt', async () => {
    const repoId = await repoIdFor(d, cfg.repohq.userId!, a.repo)
    await d.insert(schema.portfolioEvents).values(attemptEventValues(a, cfg.repohq.userId!, repoId, objective)).onConflictDoNothing()
    await d.insert(schema.agentJobs).values(agentJobValues(a, cfg.repohq.userId!, repoId)).onConflictDoNothing()
  })
}

/** Copy ledger history into `agent_jobs` (idempotent: existing rows are left alone). Returns rows written. */
export async function backfillJobs(cfg: FactoryConfig, attempts: AttemptEntry[], resolutions: Map<string, { outcome: 'merged' | 'rejected'; at: string; humanCommits?: number }>): Promise<number> {
  const d = db(cfg)
  if (!d) throw new Error('RepoHQ sink not configured (FACTORY_USER_ID + database URL)')
  const repoIds = new Map<string, number | null>()
  let written = 0
  for (const a of attempts.filter(x => x.outcome !== 'rate_limited')) {
    if (!repoIds.has(a.repo)) repoIds.set(a.repo, await repoIdFor(d, cfg.repohq.userId!, a.repo))
    const r = resolutions.get(a.id)
    const rows = await d.insert(schema.agentJobs).values({
      ...agentJobValues(a, cfg.repohq.userId!, repoIds.get(a.repo) ?? null),
      ...(r ? { outcome: r.outcome, resolvedAt: new Date(r.at), humanCommits: r.humanCommits ?? null } : {}),
    }).onConflictDoNothing().returning({ id: schema.agentJobs.id })
    written += rows.length
  }
  return written
}

/** The `agent_jobs` row for one attempt (Phase 79). */
export function agentJobValues(a: AttemptEntry, userId: string, repoId: number | null): typeof schema.agentJobs.$inferInsert {
  return {
    id: a.id, userId, repoId, repo: a.repo, parentJobId: a.parentId ?? null, runId: a.runId,
    taskKind: a.kind, pipeline: PIPELINES[a.kind as TaskKind] ?? null, tier: a.tier, model: a.model, harness: a.harness,
    isolation: a.isolation ?? 'host', status: a.outcome, reason: a.reason, requests: a.requests ?? null,
    inputTokens: a.inputTokens, outputTokens: a.outputTokens, costUsd: a.costUsd, durationMs: a.durationMs,
    reported: a.reported ?? false, prUrl: a.prUrl ?? null,
    adversaryModel: a.adversary?.model ?? null, adversaryVerdict: a.adversary?.verdict ?? null,
    startedAt: new Date(a.at),
    requestId: a.ownerTaskId ?? null,
  }
}

export async function recordScout(
  cfg: FactoryConfig,
  r: { primary: string | null; backup: string | null; scores: { model: string; passes: number; total: number }[]; dryRun: boolean },
): Promise<void> {
  const d = db(cfg)
  if (!d) return
  await safely('recordScout', async () => {
    await d.insert(schema.portfolioEvents).values({
      userId: cfg.repohq.userId!,
      eventType: 'model_scout_report',
      title: `🔭 Model scout: free-agent → ${r.primary ?? 'unchanged'}`,
      description: r.scores.map(s => `${s.model} ${s.passes}/${s.total}`).join(' · '),
      metadata: { source: 'factory', ...r },
    })
  })
}

/** Human boundary (docs/autonomous-factory.md §7): in-app notification; RepoHQ's webhook settings fan it out. */
export async function recordApprovalNeeded(cfg: FactoryConfig, repo: string, title: string, body: string): Promise<void> {
  const d = db(cfg)
  if (!d) return
  await safely('recordApprovalNeeded', async () => {
    const repoId = await repoIdFor(d, cfg.repohq.userId!, repo)
    await d.insert(schema.notifications).values({
      userId: cfg.repohq.userId!,
      repoId,
      eventType: 'agent_failed',
      title,
      body,
      metadata: { source: 'factory', awaitingApproval: true },
    })
  })
}

/** Learn step mirror: stamp the attempt's RepoHQ event with how the PR ended. */
export async function recordResolution(cfg: FactoryConfig, attemptId: string, resolution: 'merged' | 'rejected', humanCommits: number | null = null): Promise<void> {
  const d = db(cfg)
  if (!d) return
  const resolvedAt = new Date()
  await safely('recordResolution', async () => {
    await d.update(schema.portfolioEvents)
      .set({ metadata: sql`coalesce(${schema.portfolioEvents.metadata}, '{}'::jsonb) || ${JSON.stringify({ resolution, resolvedAt: resolvedAt.toISOString(), humanCommits })}::jsonb` })
      .where(and(eq(schema.portfolioEvents.userId, cfg.repohq.userId!), eq(schema.portfolioEvents.dedupKey, `factory:${attemptId}`)))
    await d.update(schema.agentJobs)
      .set({ outcome: resolution, resolvedAt, humanCommits })
      .where(and(eq(schema.agentJobs.userId, cfg.repohq.userId!), eq(schema.agentJobs.id, attemptId)))
  })
}

/** Generic in-app notification (morning report fallback when email isn't configured). */
export async function recordNotification(cfg: FactoryConfig, title: string, body: string): Promise<void> {
  const d = db(cfg)
  if (!d) return
  await safely('recordNotification', async () => {
    await d.insert(schema.notifications).values({ userId: cfg.repohq.userId!, eventType: 'agent_pr_ready', title, body, metadata: { source: 'factory', kind: 'morning_report' } })
  })
}
