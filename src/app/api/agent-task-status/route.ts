import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { portfolioEvents } from '@/lib/db/schema'
import { eq, and, inArray, desc } from 'drizzle-orm'
import { getRepoLifecycle } from '@/lib/agents/lifecycle'

export type AgentTaskStage =
  | 'queued'
  | 'preparing'
  | 'running'
  | 'pr_ready'
  | 'merged'
  | 'report_ready'
  | 'failed'
  | 'timed_out'

const STAGE_LABELS: Record<string, string> = {
  idle:         'Idle',
  queued:       'Queued',
  preparing:    'Preparing context…',
  running:      'Agent running…',
  pr_ready:     'PR created',
  merged:       'PR merged',
  report_ready: 'Report ready',
  failed:       'Agent failed',
  timed_out:    'Timed out',
}

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(request.url)
  const taskId = url.searchParams.get('taskId')
  const repoIdParam = url.searchParams.get('repoId')

  // ── repoId path: lifecycle lookup by repo (used by QueueButton mount hydration) ──
  if (repoIdParam && !taskId) {
    const repoId = parseInt(repoIdParam, 10)
    if (isNaN(repoId)) return NextResponse.json({ error: 'invalid repoId' }, { status: 400 })
    const lifecycle = await getRepoLifecycle(session.user.id, repoId)
    return NextResponse.json({
      status:  lifecycle.stage,
      stage:   STAGE_LABELS[lifecycle.stage as keyof typeof STAGE_LABELS] ?? lifecycle.stage,
      taskId:  lifecycle.taskId,
      prUrl:   lifecycle.prUrl,
      nexusUrl: process.env.NEXUS_API_URL?.replace(/\/$/, '') ?? null,
    })
  }

  if (!taskId) return NextResponse.json({ error: 'taskId or repoId required' }, { status: 400 })

  const nexusUrl   = process.env.NEXUS_API_URL?.replace(/\/$/, '')
  const nexusToken = process.env.NEXUS_API_TOKEN

  // 1. Check portfolio_events for terminal outcome events
  const events = await db.query.portfolioEvents.findMany({
    where: and(
      eq(portfolioEvents.userId, session.user.id),
      inArray(portfolioEvents.eventType, [
        'agent_task_queued', 'agent_pr_created', 'agent_pr_merged',
        'agent_execution_failed', 'agent_skill_report',
      ]),
    ),
    orderBy: [desc(portfolioEvents.occurredAt)],
    limit: 50,
  })

  const matching = events.filter(e => {
    const meta = e.metadata as { taskId?: string } | null
    return meta?.taskId === taskId
  })

  const prMerged    = matching.find(e => e.eventType === 'agent_pr_merged')
  const prCreated   = matching.find(e => e.eventType === 'agent_pr_created')
  const execFailed  = matching.find(e => e.eventType === 'agent_execution_failed')
  const skillReport = matching.find(e => e.eventType === 'agent_skill_report')

  if (prMerged)  {
    const meta = prMerged.metadata as { prUrl?: string } | null
    return ok('merged',   { prUrl: meta?.prUrl, nexusUrl })
  }
  if (prCreated) {
    const meta = prCreated.metadata as { prUrl?: string } | null
    return ok('pr_ready', { prUrl: meta?.prUrl, nexusUrl })
  }
  if (skillReport) return ok('report_ready', { nexusUrl })
  if (execFailed)  return ok('failed', { nexusUrl })

  // 2. Poll Nexus directly for live stage (webhook may not have fired yet)
  if (nexusUrl && nexusToken) {
    try {
      const taskRes = await fetch(`${nexusUrl}/internal/agent-tasks/${taskId}`, {
        headers: { 'Authorization': `Bearer ${nexusToken}` },
        signal: AbortSignal.timeout(4000),
      })
      if (taskRes.ok) {
        const task = await taskRes.json() as { status?: string }
        if (task.status === 'preparing') return ok('preparing', { nexusUrl })
        if (task.status === 'failed')    return ok('failed',    { nexusUrl })
        if (task.status === 'ready') {
          // Task is ready — check executions
          const execRes = await fetch(`${nexusUrl}/internal/agent-tasks/${taskId}/executions`, {
            headers: { 'Authorization': `Bearer ${nexusToken}` },
            signal: AbortSignal.timeout(4000),
          })
          if (execRes.ok) {
            const execs = await execRes.json() as Array<{ status?: string }>
            const active = execs.find(e =>
              ['queued','running','changes-generated','validated','pr-opened'].includes(e.status ?? '')
            )
            if (active?.status === 'pr-opened') return ok('pr_ready', { nexusUrl })
            if (active) return ok('running', { nexusUrl })
          }
          return ok('running', { nexusUrl })
        }
      }
    } catch { /* Nexus unreachable — fall through */ }
  }

  // 3. Timeout check: queued >15 min ago with no progress
  const queuedEvent = matching.find(e => e.eventType === 'agent_task_queued')
  if (queuedEvent) {
    const age = Date.now() - new Date(queuedEvent.occurredAt).getTime()
    if (age > 15 * 60 * 1000) return ok('timed_out', { nexusUrl })
  }

  return ok('queued', { nexusUrl })
}

function ok(status: AgentTaskStage, opts: { prUrl?: string | null; nexusUrl?: string | null } = {}) {
  return NextResponse.json({ status, stage: STAGE_LABELS[status], ...opts })
}
