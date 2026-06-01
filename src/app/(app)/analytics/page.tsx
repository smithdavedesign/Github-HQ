import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { repositories, repositoryMetrics } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { HealthTrendChart } from '@/components/dashboard/health-trend-chart'
import { EffortMatrix } from '@/components/dashboard/effort-matrix'
import { DepGraphCard } from '@/components/dashboard/dep-graph'
import type { DepNode, DepEdge } from '@/components/dashboard/dep-graph'

export default async function AnalyticsPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const reposWithMetrics = await db.query.repositories.findMany({
    where: eq(repositories.userId, session.user.id),
    with: { metrics: true },
    columns: { id: true, name: true, estimatedEffort: true },
  })

  const chartData = reposWithMetrics
    .filter((r) => r.metrics?.healthScore != null)
    .sort((a, b) => (b.metrics!.healthScore! - a.metrics!.healthScore!))
    .slice(0, 20)
    .map((r) => ({
      name: r.name,
      health: Math.round(r.metrics!.healthScore!),
      activity: Math.round(r.metrics!.activityScore ?? 0),
      security: Math.round(r.metrics!.securityScore ?? 100),
    }))

  const matrixRepos = reposWithMetrics
    .filter(r => r.metrics?.opportunityScore != null)
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
        depEdges.push({ source: r.id, target: targetId })
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

      <HealthTrendChart data={chartData} />
      <EffortMatrix repos={matrixRepos} />
      <DepGraphCard nodes={depNodes} edges={depEdges} />
    </div>
  )
}
