import { and, eq, gte, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { agentJobs, notifications } from '@/lib/db/schema'
import { computeFactoryKpis, jobRecordFromRow, type FactoryKpis } from './factory-kpis'

export const KPI_WINDOW_DAYS = 30

/** Factory KPIs for one user from the `agent_jobs` job record (Phase 79); null when there are no jobs. */
export async function loadFactoryKpis(userId: string, now = new Date()): Promise<FactoryKpis | null> {
  const since = new Date(now.getTime() - KPI_WINDOW_DAYS * 86_400_000)
  const [jobs, approvals] = await Promise.all([
    db.query.agentJobs.findMany({
      where: and(eq(agentJobs.userId, userId), gte(agentJobs.startedAt, since)),
      columns: { id: true, startedAt: true, tier: true, status: true, prUrl: true, outcome: true, resolvedAt: true, humanCommits: true, requests: true, adversaryModel: true },
    }),
    // Approval requests the factory raised (free tiers failed, paid tier gated) count against autonomy.
    db.select({ n: sql<number>`count(*)::int` }).from(notifications).where(and(
      eq(notifications.userId, userId), gte(notifications.createdAt, since),
      sql`${notifications.metadata}->>'source' = 'factory' and (${notifications.metadata}->>'awaitingApproval')::boolean`,
    )),
  ])
  if (jobs.length === 0) return null
  return computeFactoryKpis(jobs.map(jobRecordFromRow), now, { windowDays: KPI_WINDOW_DAYS, approvalsNeeded: approvals[0]?.n ?? 0 })
}
