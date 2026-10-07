'use server'

import { auth } from '@/lib/auth'
import type { AdvisorAction } from '@/lib/ai/advisor'
import { AGENTS_PAGE, queueAdvisorActionForUser, queueSkillForUser } from '@/lib/agents/factory-queue'
import type { GstackSkill } from '@/lib/skills/skill-policy'

// Browser-facing actions only: each derives the user from the session and queues work for the
// factory (roadmap Phase 81). Session-less dispatch (cron) is in src/lib/agents/factory-queue.ts.
// Types only below — a 'use server' file may export nothing but async functions at runtime.

export interface QueuedTask {
  taskId: string
  status: 'queued'
  /** Where the request can be followed (the Agents page). */
  monitorUrl: string
}

/** "Run agent" on an advisor action. Throws a plain Error with the reason when it can't be queued. */
export async function queueAdvisorAction(action: AdvisorAction): Promise<QueuedTask> {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  const r = await queueAdvisorActionForUser(session.user.id, action, 'ui-advisor')
  if (!r.ok) throw new Error(r.reason)
  return { taskId: r.taskId, status: 'queued', monitorUrl: AGENTS_PAGE }
}

/**
 * Queue a gstack skill on a repo — from the repo Agent tab's launcher or a findings preview.
 * Fix skills come back as a judged draft PR, report skills as findings (docs/agent-hq-migration-prd.md §8).
 */
export async function queueGstackSkill(repoId: number, skill: GstackSkill, objective: string): Promise<QueuedTask> {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  const text = objective.trim()
  if (!text) throw new Error('Describe what the agent should do')
  const r = await queueSkillForUser(session.user.id, repoId, skill, text, 'ui-skill')
  if (!r.ok) throw new Error(r.reason)
  return { taskId: r.taskId, status: 'queued', monitorUrl: AGENTS_PAGE }
}
