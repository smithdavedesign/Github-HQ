'use server'

import { and, eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { agentRequests } from '@/lib/db/schema'
import { enqueueRequest, factoryAccess } from '@/lib/agents/factory-queue'
import { isGstackSkill } from '@/lib/skills/skill-policy'
import type { RequestSource } from '@/lib/agents/factory-request-utils'
import { manualJobOptions, withQueue, type ScheduledJobName } from '../../../factory/lib/queue'

// Agents page controls (roadmap Phase 81, docs/agent-hq-migration-prd.md §9). Every action derives
// the user from the session and refuses anyone but the factory's owner.

async function ownerId(): Promise<string> {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  const access = factoryAccess(session.user.id)
  if (!access.ok) throw new Error(access.reason)
  return session.user.id
}

function redisUrl(): string {
  const url = process.env.REDIS_URL
  if (!url) throw new Error('The factory queue is not configured (REDIS_URL is not set).')
  return url
}

const SCHEDULED: readonly ScheduledJobName[] = ['cycle', 'report', 'scout']

/** Run a scheduled kind now (it waits its turn behind requests; the worker's gates still apply). */
export async function runNow(kind: ScheduledJobName): Promise<{ jobId: string }> {
  await ownerId()
  if (!SCHEDULED.includes(kind)) throw new Error(`Unknown job kind "${String(kind)}"`)
  const opts = manualJobOptions(kind, new Date())
  await withQueue(redisUrl(), q => q.add(kind, { trigger: 'manual' }, opts))
  return { jobId: String(opts.jobId) }
}

/** Pause or resume the whole queue (the job that is running finishes; nothing new starts). */
export async function setQueuePaused(paused: boolean): Promise<{ paused: boolean }> {
  await ownerId()
  await withQueue(redisUrl(), q => (paused ? q.pause() : q.resume()))
  return { paused }
}

/** Cancel a request that hasn't started. A running one finishes (its outcome is then dropped). */
export async function cancelRequest(requestId: string): Promise<void> {
  const userId = await ownerId()
  const now = new Date()
  const updated = await db.update(agentRequests)
    .set({ status: 'cancelled', reason: 'Cancelled from the Agents page', resolvedAt: now, updatedAt: now })
    .where(and(eq(agentRequests.id, requestId), eq(agentRequests.userId, userId), eq(agentRequests.status, 'queued')))
    .returning({ id: agentRequests.id })
  if (updated.length === 0) throw new Error('Only a queued request can be cancelled.')
  // Best effort: the worker also drops a job whose request is no longer open.
  const url = process.env.REDIS_URL
  if (url) await withQueue(url, async q => { await (await q.getJob(requestId))?.remove() }).catch(() => {})
}

/** Queue a finished request again as a new one (same repo, skill and objective). */
export async function retryRequest(requestId: string): Promise<{ taskId: string }> {
  const userId = await ownerId()
  const old = await db.query.agentRequests.findFirst({
    where: and(eq(agentRequests.id, requestId), eq(agentRequests.userId, userId)),
  })
  if (!old) throw new Error('Request not found')
  if (old.status === 'queued' || old.status === 'running') throw new Error('This request is still open.')
  if (!old.repoId) throw new Error('The repo is no longer synced to RepoHQ.')
  const skill = old.skill && isGstackSkill(old.skill) ? old.skill : old.mode === 'report' ? 'investigate' : 'ship'
  const source: RequestSource = old.source === 'ui-advisor' ? 'ui-advisor' : 'ui-skill'
  const r = await enqueueRequest({
    userId, repoId: old.repoId, skill, objective: old.objective, source,
    title: `Retry: ${old.objective.slice(0, 80)}`, extra: { retryOf: old.id },
    // A retry repeats what the owner already chose.
    skipSkillPolicy: true,
  })
  if (!r.ok) throw new Error(r.reason)
  return { taskId: r.taskId }
}
