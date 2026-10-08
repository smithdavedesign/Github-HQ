import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { repositories, repositoryMetrics } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { HealthTrendChart } from '@/components/dashboard/health-trend-chart'
import { HealthTrendLineChart } from '@/components/dashboard/health-trend-line-chart'
import { EffortMatrix } from '@/components/dashboard/effort-matrix'
import { DepGraphCard } from '@/components/dashboard/dep-graph'
import type { DepNode, DepEdge } from '@/components/dashboard/dep-graph'
import { getPortfolioHealthTrend } from '@/lib/health/history'
import { getAgentStats } from '@/lib/actions/repositories'
import { AgentStatsBlock } from '@/components/dashboard/agent-stats-block'

export default async function AnalyticsPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const [reposWithMetrics, healthTrend, agentStats] = await Promise.all([
    db.query.repositories.findMany({
      where: eq(repositories.userId, session.user.id),
      with: { metrics: true },
      columns: { id: true, name: true, estimatedEffort: true, isArchived: true, lifecycleStatus: true },
    }),
    getPortfolioHealthTrend(session.user.id),
    getAgentStats(),
  ])

  const chartData = reposWithMetrics
    .filter((r) => r.metrics?.healthScore != null)
    .sort((a, b) => (b.metrics!.healthScore! - a.metrics!.healthScore!))
    .slice(0, 20)
    .map((r) => ({
      name: r.name,
      health: Math.round(r.metrics!.healthScore!),
      activity: Math.round(r.metrics!.activityScore ?? 0),
      // null = unknown (Dependabot alerts off): drawn as "no data", never as a perfect 100.
      security: r.metrics!.securityScore == null ? null : Math.round(r.metrics!.securityScore),
    }))

  const livePortfolioHealth = reposWithMetrics.filter((r) => r.metrics?.healthScore != null)
  const livePortfolioAverage = livePortfolioHealth.length > 0
    ? livePortfolioHealth.reduce((sum, repo) => {
        const metrics = repo.metrics!
        const knownSecurity = metrics.securityScore != null
        return {
          health: sum.health + (metrics.healthScore ?? 0),
          // Average security over repos where it's known only.
          security: sum.security + (knownSecurity ? metrics.securityScore! : 0),
          securityCount: sum.securityCount + (knownSecurity ? 1 : 0),
          activity: sum.activity + (metrics.activityScore ?? 0),
        }
      }, { health: 0, security: 0, securityCount: 0, activity: 0 })
    : null

  const liveTrendFallback = livePortfolioAverage
    ? [{
        date: new Date().toISOString().slice(0, 10),
        avgHealth: Math.round(livePortfolioAverage.health / livePortfolioHealth.length),
        avgSecurity: livePortfolioAverage.securityCount ? Math.round(livePortfolioAverage.security / livePortfolioAverage.securityCount) : 0,
        avgActivity: Math.round(livePortfolioAverage.activity / livePortfolioHealth.length),
      }]
    : []

  const matrixRepos = reposWithMetrics
    .filter(r => r.metrics?.opportunityScore != null && !r.isArchived && r.lifecycleStatus !== 'archived')
    .map(r => ({
      id: r.id,
      name: r.name,
      opportunityScore: r.metrics!.opportunityScore ?? 0,
      estimatedEffort: r.estimatedEffort,
    }))

  // Phase 29: dependency graph data
  const depNodes: DepNode[] = reposWithMetrics
    .filter(r => r.metrics?.healthScore != null)
    .map(r => ({
      id: r.id,
      name: r.name,
      health: Math.round(r.metrics!.healthScore!),
    }))

  const repoNameToId = new Map(reposWithMetrics.map(r => [r.name, r.id]))
  const depEdges: DepEdge[] = []
  for (const r of reposWithMetrics) {
    const internalDeps = r.metrics?.internalDeps as string[] | null | undefined
    if (!internalDeps || internalDeps.length === 0) continue
    for (const depName of internalDeps) {
      const targetId = repoNameToId.get(depName)
      if (targetId && targetId !== r.id) {
        depEdges.push({ source: r.id, target: targetId, type: 'internal' })
      }
    }
  }

  // Phase 33: shared external deps — undirected edges between repos that have a
  // prominent third-party package in common. Capped to avoid edge explosion.
  const MAX_EXTERNAL_EDGES = 15
  const reposWithExternalDeps = reposWithMetrics
    .map(r => ({ id: r.id, externalDeps: r.metrics?.externalDeps as string[] | null | undefined }))
    .filter(r => r.externalDeps && r.externalDeps.length > 0) as { id: number; externalDeps: string[] }[]

  let externalEdgeCount = 0
  for (let i = 0; i < reposWithExternalDeps.length && externalEdgeCount < MAX_EXTERNAL_EDGES; i++) {
    for (let j = i + 1; j < reposWithExternalDeps.length && externalEdgeCount < MAX_EXTERNAL_EDGES; j++) {
      const a = reposWithExternalDeps[i]
      const b = reposWithExternalDeps[j]
      const shared = a.externalDeps.filter(d => b.externalDeps.includes(d))
      if (shared.length > 0) {
        depEdges.push({ source: a.id, target: b.id, type: 'external', label: shared.join(', ') })
        externalEdgeCount++
      }
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Portfolio health trends, score breakdowns, and effort planning
        </p>
      </div>

      <HealthTrendLineChart data={healthTrend.snapshotDays >= 3 ? healthTrend.series : liveTrendFallback} hasLiveFallback={healthTrend.snapshotDays < 3 && liveTrendFallback.length > 0} />
      <HealthTrendChart data={chartData} />
      <EffortMatrix repos={matrixRepos} />
      {agentStats && <AgentStatsBlock stats={agentStats} />}
      <DepGraphCard nodes={depNodes} edges={depEdges} />
    </div>
  )
}
