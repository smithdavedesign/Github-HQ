import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { and, eq, ilike, sql } from 'drizzle-orm'
import * as schema from '../../src/lib/db/schema'
import type { FactoryConfig } from './config'
import type { AttemptEntry } from './ledger'

/**
 * Optional mirror of factory activity into RepoHQ (same direct-to-Neon pattern
 * as mcp/server.ts). Enabled only when FACTORY_DATABASE_URL and FACTORY_USER_ID
 * are set. Never throws — the local ledger stays the source of truth.
 *
 * Attempts are written as `agent_attempt` events (repo Agent tab, dead-end
 * detection, attempt distiller). Factory PRs are deliberately NOT written as
 * `agent_pr_created`: that would make RepoHQ's CI checker queue paid Nexus fixes.
 */

type Db = ReturnType<typeof drizzle<typeof schema>>
let cached: Db | null = null

function db(cfg: FactoryConfig): Db | null {
  if (!cfg.repohq.databaseUrl || !cfg.repohq.userId) return null
  cached ??= drizzle(neon(cfg.repohq.databaseUrl), { schema })
  return cached
}

async function repoIdFor(d: Db, userId: string, fullName: string): Promise<number | null> {
  const repo = await d.query.repositories.findFirst({
    where: and(eq(schema.repositories.userId, userId), ilike(schema.repositories.fullName, fullName)),
    columns: { id: true },
  })
  return repo?.id ?? null
}

async function safely(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    console.warn(`[factory sink] ${label} failed:`, err instanceof Error ? err.message : err)
  }
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
  })
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
export async function recordResolution(cfg: FactoryConfig, attemptId: string, resolution: 'merged' | 'rejected'): Promise<void> {
  const d = db(cfg)
  if (!d) return
  await safely('recordResolution', async () => {
    await d.update(schema.portfolioEvents)
      .set({ metadata: sql`coalesce(${schema.portfolioEvents.metadata}, '{}'::jsonb) || ${JSON.stringify({ resolution })}::jsonb` })
      .where(and(eq(schema.portfolioEvents.userId, cfg.repohq.userId!), eq(schema.portfolioEvents.dedupKey, `factory:${attemptId}`)))
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
