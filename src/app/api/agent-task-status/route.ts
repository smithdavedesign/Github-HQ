import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { agentRequests, portfolioEvents } from '@/lib/db/schema'
import { eq, and, inArray, desc } from 'drizzle-orm'
import { getRepoLifecycle } from '@/lib/agents/lifecycle'
import { LIFECYCLE_TIMEOUT_MS, prFollowUpStage } from '@/lib/agents/lifecycle-utils'
import { stageForRequest } from '@/lib/agents/factory-request-utils'

export type AgentTaskStage =
  | 'idle'
  | 'queued'
  | 'preparing'
  | 'running'
  | 'pr_ready'
  | 'ci_failing'
  | 'needs_human'
  | 'awaiting_approval'
  | 'merged'
  | 'rejected'
  | 'report_ready'
  | 'verified'
  | 'failed'
  | 'timed_out'

const STAGE_LABELS: Record<AgentTaskStage, string> = {
  idle:              'Idle',
  queued:            'Queued — waiting for the factory',
  preparing:         'Preparing context…',
  running:           'Agent running…',
  pr_ready:          'PR created',
  ci_failing:        'CI failing on the PR',
  needs_human:       'Needs human review',
  awaiting_approval: 'Awaiting approval',
  merged:            'PR merged',
  rejected:          'PR closed — not merged',
  report_ready:      'Report ready',
  verified:          'Verified — held, no PR',
  failed:            'Agent failed',
  timed_out:         'Timed out',
}

/** Where requests are followed in detail (queue, trace, findings). */
const MONITOR_URL = '/agent-performance'

const TASK_EVENTS = [
  'agent_task_queued', 'agent_pr_created', 'agent_pr_merged', 'agent_pr_rejected',
  'agent_execution_failed', 'agent_skill_report',
  'agent_ci_failed', 'agent_needs_human', 'agent_awaiting_approval',
]

/**
 * Agent task status for the Run-agent buttons and the skill launcher.
 *   ?repoId=…  the repo's current lifecycle (button hydration on mount)
 *   ?taskId=…  one task: an Agent HQ request (its agent_requests row, roadmap Phase 81),
 *              or an older Nexus task (projected from portfolio_events)
 */
export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const userId = session.user.id

  const url = new URL(request.url)
  const taskId = url.searchParams.get('taskId')
  const repoIdParam = url.searchParams.get('repoId')

  // ── repoId path: lifecycle lookup by repo (used by QueueButton mount hydration) ──
  if (repoIdParam && !taskId) {
    const repoId = parseInt(repoIdParam, 10)
    if (isNaN(repoId)) return NextResponse.json({ error: 'invalid repoId' }, { status: 400 })
    const lifecycle = await getRepoLifecycle(userId, repoId)
    return ok(lifecycle.stage, { taskId: lifecycle.taskId, prUrl: lifecycle.prUrl, reason: lifecycle.reason ?? null })
  }

  if (!taskId) return NextResponse.json({ error: 'taskId or repoId required' }, { status: 400 })

  const events = await db.query.portfolioEvents.findMany({
    where: and(eq(portfolioEvents.userId, userId), inArray(portfolioEvents.eventType, TASK_EVENTS)),
    orderBy: [desc(portfolioEvents.occurredAt)],
    limit: 100,
  })
  const matching = events.filter(e => (e.metadata as { taskId?: string } | null)?.taskId === taskId)
  const find = (t: string) => matching.find(e => e.eventType === t)
  const prUrlOf = (e: (typeof matching)[number] | undefined) => (e?.metadata as { prUrl?: string } | null)?.prUrl ?? null

  // Newest first (the query's order), as prFollowUpStage expects.
  const followUp = prFollowUpStage(matching)
  if (followUp) return ok(followUp.stage, { prUrl: prUrlOf(followUp.event) })

  const skillReport = find('agent_skill_report')
  const reportPreview = () => {
    const srMeta = skillReport?.metadata as { findings?: string[]; skillName?: string } | null
    return { previewFindings: srMeta?.findings?.filter(f => f && f.trim()).slice(0, 2) ?? [], skillName: srMeta?.skillName }
  }

  // Agent HQ request: the row is the truth for everything before a PR outcome.
  const row = await db.query.agentRequests.findFirst({
    where: and(eq(agentRequests.id, taskId), eq(agentRequests.userId, userId)),
    columns: { status: true, prUrl: true, reason: true },
  })
  if (row) {
    const stage = stageForRequest(row.status)
    return ok(stage, { prUrl: row.prUrl, reason: row.reason, ...(stage === 'report_ready' ? reportPreview() : {}) })
  }

  // Older Nexus task: project from its events.
  const prCreated = find('agent_pr_created')
  if (prCreated) return ok('pr_ready', { prUrl: prUrlOf(prCreated) })
  if (skillReport) return ok('report_ready', reportPreview())
  if (find('agent_execution_failed')) return ok('failed')
  const queuedEvent = find('agent_task_queued')
  if (queuedEvent && Date.now() - new Date(queuedEvent.occurredAt).getTime() > LIFECYCLE_TIMEOUT_MS) return ok('timed_out')
  return ok('queued')
}

function ok(status: AgentTaskStage, opts: { taskId?: string | null; prUrl?: string | null; reason?: string | null; previewFindings?: string[]; skillName?: string } = {}) {
  return NextResponse.json({ status, stage: STAGE_LABELS[status], monitorUrl: MONITOR_URL, ...opts })
}
