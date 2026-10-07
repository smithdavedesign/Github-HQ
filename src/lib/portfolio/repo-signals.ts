import { and, eq, inArray, sql } from 'drizzle-orm'
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http'
import * as schema from '../db/schema'
import type { RepoSignals } from './next-actions'

/**
 * Inputs for next-actions.ts, one row per repo. The dashboard and the factory's morning report
 * both read it, each with its own Neon client, so this module has no `server-only` and only
 * relative imports (same pattern as agents/factory-activity.ts).
 */
export async function loadRepoSignals(
  db: NeonHttpDatabase<typeof schema>, userId: string, now: Date, factoryRepos: readonly string[],
): Promise<RepoSignals[]> {
  const repos = await db.query.repositories.findMany({
    where: eq(schema.repositories.userId, userId),
    columns: { id: true, name: true, fullName: true, lifecycleStatus: true, isFocused: true, isArchived: true, purpose: true, mrr: true },
    with: { metrics: { columns: { healthScore: true, activityStatus: true, buildStatus: true, lastPush: true, openPrs: true, archiveScore: true } } },
  })
  if (repos.length === 0) return []
  const ids = repos.map(r => r.id)
  const f = schema.securityFindings
  const [alerts, deploys] = await Promise.all([
    db.select({
      repoId: f.repoId,
      critical: sql<number>`count(*) filter (where ${f.severity} = 'critical')`.mapWith(Number),
      high: sql<number>`count(*) filter (where ${f.severity} = 'high')`.mapWith(Number),
    }).from(f).where(and(inArray(f.repoId, ids), eq(f.state, 'open'))).groupBy(f.repoId),
    db.selectDistinct({ repoId: schema.deployments.repoId }).from(schema.deployments).where(inArray(schema.deployments.repoId, ids)),
  ])
  const alertsBy = new Map(alerts.map(a => [a.repoId, a]))
  const live = new Set(deploys.map(d => d.repoId))
  const allow = new Set(factoryRepos.map(r => r.toLowerCase()))
  return repos.map(r => {
    const m = r.metrics
    const a = alertsBy.get(r.id)
    return {
      id: r.id, name: r.name, fullName: r.fullName,
      lifecycleStatus: r.lifecycleStatus, isFocused: r.isFocused ?? false, isArchived: r.isArchived ?? false, purpose: r.purpose,
      mrr: Number(r.mrr ?? 0) || 0,
      hasProductionUrl: live.has(r.id),
      healthScore: m?.healthScore ?? null,
      activityStatus: m?.activityStatus ?? null,
      buildStatus: m?.buildStatus ?? null,
      daysSincePush: m?.lastPush ? Math.max(0, Math.floor((now.getTime() - m.lastPush.getTime()) / 86_400_000)) : null,
      openPrs: m?.openPrs ?? 0,
      archiveScore: m?.archiveScore ?? 0,
      criticalAlerts: a?.critical ?? 0,
      highAlerts: a?.high ?? 0,
      factoryManaged: allow.has(r.fullName.toLowerCase()),
    }
  })
}
