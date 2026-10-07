import { and, eq, inArray, ne, sql } from 'drizzle-orm'
import * as schema from '../../src/lib/db/schema'
import { findingsFromReport, OPEN_REQUEST_STATUSES, type RequestMode } from '../../src/lib/agents/factory-request-utils'
import type { FactoryConfig } from './config'
import type { OwnerOutcome, OwnerRequest } from './owner-requests'
import { repoIdFor, safely, sinkDb } from './sink'

/**
 * The factory's side of `agent_requests` (roadmap Phase 81, docs/agent-hq-migration-prd.md §6–§7):
 * load and claim a request for a worker job, put it back when deferred, and write its terminal
 * outcome plus the portfolio_events RepoHQ already consumes (lifecycle, PR-merge detection,
 * advisor accuracy, skill findings). OpenClaw's JSONL requests are mirrored in, so every
 * request — whatever its source — shows up on the Agents page with its trace.
 */

export type AgentRequestRow = typeof schema.agentRequests.$inferSelect
type EventInsert = typeof schema.portfolioEvents.$inferInsert
type NotificationInsert = typeof schema.notifications.$inferInsert

/** A DB request as the factory's owner-task path runs it. */
export function toOwnerRequest(row: Pick<AgentRequestRow, 'id' | 'repo' | 'objective' | 'source' | 'mode' | 'skill' | 'createdAt'>): OwnerRequest {
  return {
    taskId: row.id, repo: row.repo, task: row.objective, source: row.source, requestedAt: row.createdAt.toISOString(),
    mode: row.mode === 'report' ? 'report' : 'fix', ...(row.skill ? { skill: row.skill } : {}), stored: true,
  }
}

/** The request row; null when it doesn't exist (or isn't the owner's). Throws on a DB error. */
export async function loadRequest(cfg: FactoryConfig, id: string): Promise<AgentRequestRow | null> {
  const d = sinkDb(cfg)
  if (!d) throw new Error('RepoHQ sink not configured (FACTORY_USER_ID + database URL)')
  const row = await d.query.agentRequests.findFirst({
    where: and(eq(schema.agentRequests.id, id), eq(schema.agentRequests.userId, cfg.repohq.userId!)),
  })
  return row ?? null
}

/**
 * Mark a request running (attempt + 1). Returns the row, or null when it's no longer open
 * (cancelled or already resolved) — the job is then dropped. Throws on a DB error.
 */
export async function claimRequest(cfg: FactoryConfig, id: string, now: Date): Promise<AgentRequestRow | null> {
  const d = sinkDb(cfg)
  if (!d) throw new Error('RepoHQ sink not configured (FACTORY_USER_ID + database URL)')
  const [row] = await d.update(schema.agentRequests)
    .set({ status: 'running', claimedAt: now, attempts: sql`${schema.agentRequests.attempts} + 1`, reason: null, updatedAt: now })
    .where(and(
      eq(schema.agentRequests.id, id),
      eq(schema.agentRequests.userId, cfg.repohq.userId!),
      inArray(schema.agentRequests.status, [...OPEN_REQUEST_STATUSES]),
    ))
    .returning()
  return row ?? null
}

/** Put a running request back in the queue with the reason it's waiting (shown on the Agents page). */
export async function deferRequest(cfg: FactoryConfig, id: string, reason: string, now: Date): Promise<void> {
  const d = sinkDb(cfg)
  if (!d) return
  await safely('deferRequest', async () => {
    await d.update(schema.agentRequests)
      .set({ status: 'queued', reason: reason.slice(0, 500), updatedAt: now })
      .where(and(eq(schema.agentRequests.id, id), inArray(schema.agentRequests.status, [...OPEN_REQUEST_STATUSES])))
  })
}

/**
 * Requests still open (queued or running), oldest first: the worker's reconcile input. OpenClaw's
 * mirrored rows are left out: the cycle serves them from the JSONL front door, which is where
 * their result must go. Re-queued as worker jobs they ran a second time and never reported back.
 */
export async function openRequests(cfg: FactoryConfig): Promise<Pick<AgentRequestRow, 'id' | 'status' | 'repo' | 'createdAt'>[]> {
  const d = sinkDb(cfg)
  if (!d) return []
  let rows: Pick<AgentRequestRow, 'id' | 'status' | 'repo' | 'createdAt'>[] = []
  await safely('openRequests', async () => {
    rows = await d.query.agentRequests.findMany({
      where: and(
        eq(schema.agentRequests.userId, cfg.repohq.userId!),
        inArray(schema.agentRequests.status, [...OPEN_REQUEST_STATUSES]),
        ne(schema.agentRequests.source, 'openclaw'),
      ),
      columns: { id: true, status: true, repo: true, createdAt: true },
      orderBy: (r, { asc }) => [asc(r.createdAt)],
      limit: 200,
    })
  })
  return rows
}

/**
 * OpenClaw's JSONL request → an agent_requests row, so it's visible and traced in Agent HQ. The
 * first cycle inserts it as running; a later cycle picking it up again flips it from queued back to
 * running. Returns the row's status (null when there's no sink or it couldn't be read), so a
 * request cancelled in Agent HQ isn't run.
 */
export async function mirrorOwnerRequest(cfg: FactoryConfig, req: OwnerRequest, now: Date): Promise<string | null> {
  const d = sinkDb(cfg)
  if (!d || req.stored) return null
  let status: string | null = null
  await safely('mirrorOwnerRequest', async () => {
    const repoId = await repoIdFor(d, cfg.repohq.userId!, req.repo)
    const mine = and(eq(schema.agentRequests.id, req.taskId), eq(schema.agentRequests.userId, cfg.repohq.userId!), eq(schema.agentRequests.source, 'openclaw'))
    await d.insert(schema.agentRequests).values({
      id: req.taskId, userId: cfg.repohq.userId!, repoId, repo: req.repo, mode: 'fix', objective: req.task.slice(0, 4_000),
      source: 'openclaw', status: 'running', attempts: 1, claimedAt: now,
      createdAt: req.requestedAt ? new Date(req.requestedAt) : now, updatedAt: now,
    }).onConflictDoNothing()
    await d.update(schema.agentRequests)
      .set({ status: 'running', claimedAt: now, attempts: sql`${schema.agentRequests.attempts} + 1`, reason: null, updatedAt: now })
      .where(and(mine, eq(schema.agentRequests.status, 'queued')))
    const [row] = await d.select({ status: schema.agentRequests.status }).from(schema.agentRequests).where(mine)
    status = row?.status ?? null
  })
  return status
}

/**
 * The cycle is ending and these mirrored OpenClaw requests are still running (it stopped before
 * their repo, or deferred them): back to queued with the reason, until the next cycle picks them up
 * from the JSONL again. Never throws.
 */
export async function requeueMirrored(cfg: FactoryConfig, ids: string[], reason: string, now: Date): Promise<void> {
  const d = sinkDb(cfg)
  if (!d || ids.length === 0) return
  await safely('requeueMirrored', async () => {
    await d.update(schema.agentRequests)
      .set({ status: 'queued', reason: reason.slice(0, 500), updatedAt: now })
      .where(and(
        inArray(schema.agentRequests.id, ids),
        eq(schema.agentRequests.userId, cfg.repohq.userId!),
        eq(schema.agentRequests.source, 'openclaw'),
        eq(schema.agentRequests.status, 'running'),
      ))
  })
}

export interface ResolvedRequest {
  id: string
  repo: string
  repoId: number | null
  mode: RequestMode
  skill: string | null
  objective: string
}

/**
 * The portfolio_events and in-app notification for a request's terminal outcome (pure, tested).
 *   pr       → agent_pr_created (PR-merge checker, lifecycle, accuracy) + "PR ready" notification
 *   reported → agent_skill_report with the findings list (findings preview, MCP findings tools)
 *   rejected/failed → agent_execution_failed + notification
 *   verified → nothing extra: the attempt event already exists and lifecycle reads the row
 */
export function requestOutcomeRecords(
  userId: string, req: ResolvedRequest, outcome: OwnerOutcome, runId: string,
): { events: EventInsert[]; notifications: NotificationInsert[] } {
  const name = req.repo.split('/')[1] ?? req.repo
  const base = { taskId: req.id, executor: 'factory', agentName: 'RepoHQ Factory', source: 'factory', runId, mode: req.mode, ...(req.skill ? { skillName: req.skill } : {}) }
  if (outcome.status === 'pr' && outcome.prUrl) {
    return {
      events: [{
        userId, repoId: req.repoId, eventType: 'agent_pr_created', title: `Agent PR created for ${name}`,
        description: req.objective.slice(0, 500), metadata: { ...base, prUrl: outcome.prUrl },
      }],
      notifications: [{
        userId, repoId: req.repoId, eventType: 'agent_pr_ready', title: `Agent PR ready for review — ${name}`,
        body: req.objective.slice(0, 300), metadata: { taskId: req.id, prUrl: outcome.prUrl, source: 'factory' },
      }],
    }
  }
  if (outcome.status === 'reported') {
    const findings = findingsFromReport(outcome.findings)
    return {
      events: [{
        userId, repoId: req.repoId, eventType: 'agent_skill_report', title: `/${req.skill ?? 'report'} findings — ${name}`,
        description: outcome.findings?.slice(0, 2_000) ?? null,
        metadata: { ...base, skillName: req.skill ?? 'report', findings, outcome: 'no-changes', suggestedNextSkill: null },
      }],
      notifications: [],
    }
  }
  if (outcome.status === 'rejected' || outcome.status === 'failed') {
    const why = outcome.reason ?? outcome.status
    return {
      events: [{
        userId, repoId: req.repoId, eventType: 'agent_execution_failed', title: `Agent execution failed for ${name}`,
        description: why.slice(0, 1_000), metadata: { ...base, reason: why.slice(0, 1_000), requestStatus: outcome.status },
      }],
      notifications: [{
        userId, repoId: req.repoId, eventType: 'agent_failed', title: `Agent request ${outcome.status} — ${name}`,
        body: why.slice(0, 300), metadata: { taskId: req.id, source: 'factory' },
      }],
    }
  }
  return { events: [], notifications: [] }
}

/** Waits before each retry of a failed outcome write: a Neon blip mustn't lose a run's result. */
const RESOLVE_RETRY_WAITS_MS = [2_000, 5_000]

/**
 * Write a request's terminal outcome (only if it's still open) and its events. Never throws. A
 * failed write is retried, and the run also hands its outcome to the worker, which writes it if
 * the row is still open afterwards (worker-policy.ts `requestOutcomeOf`). Without that, a lost
 * write made the worker re-run the request, and the re-run could end differently (a fix whose PR
 * was already open came back "rejected", and agent_pr_created was never written).
 */
export async function resolveRequest(cfg: FactoryConfig, req: ResolvedRequest, outcome: OwnerOutcome, runId: string, now: Date): Promise<void> {
  const d = sinkDb(cfg)
  if (!d) return
  for (let attempt = 0; ; attempt++) {
    try {
      return await writeOutcome(cfg, d, req, outcome, runId, now)
    } catch (err) {
      const wait = RESOLVE_RETRY_WAITS_MS[attempt]
      console.warn(`[factory sink] resolveRequest failed${wait ? ` — retrying in ${wait / 1000}s` : ''}:`, err instanceof Error ? err.message : err)
      if (wait === undefined) return
      await new Promise(resolve => setTimeout(resolve, wait))
    }
  }
}

/** Throws on a DB error, so the caller can retry. */
async function writeOutcome(cfg: FactoryConfig, d: NonNullable<ReturnType<typeof sinkDb>>, req: ResolvedRequest, outcome: OwnerOutcome, runId: string, now: Date): Promise<void> {
  const updated = await d.update(schema.agentRequests)
    .set({
      status: outcome.status, prUrl: outcome.prUrl ?? null, findings: outcome.findings?.slice(0, 8_000) ?? null,
      reason: outcome.reason?.slice(0, 1_000) ?? null, runId, resolvedAt: now, updatedAt: now,
    })
    .where(and(eq(schema.agentRequests.id, req.id), eq(schema.agentRequests.userId, cfg.repohq.userId!), inArray(schema.agentRequests.status, [...OPEN_REQUEST_STATUSES])))
    .returning({ id: schema.agentRequests.id })
  // Cancelled while running (or resolved twice): leave the row and don't emit events again.
  if (updated.length === 0) return
  const repoId = req.repoId ?? await repoIdFor(d, cfg.repohq.userId!, req.repo)
  const records = requestOutcomeRecords(cfg.repohq.userId!, { ...req, repoId }, outcome, runId)
  if (records.events.length > 0) await d.insert(schema.portfolioEvents).values(records.events)
  if (records.notifications.length > 0) await d.insert(schema.notifications).values(records.notifications)
}

/** Mark an open request failed (the run crashed or ended without resolving it). Never throws. */
export async function failRequest(cfg: FactoryConfig, req: ResolvedRequest, reason: string, runId: string, now: Date): Promise<void> {
  await resolveRequest(cfg, req, { status: 'failed', reason }, runId, now)
}

export function resolvedFromRow(row: Pick<AgentRequestRow, 'id' | 'repo' | 'repoId' | 'mode' | 'skill' | 'objective'>): ResolvedRequest {
  return { id: row.id, repo: row.repo, repoId: row.repoId, mode: row.mode === 'report' ? 'report' : 'fix', skill: row.skill, objective: row.objective }
}
