import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { repositories, repositoryMetrics } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import { HealthTrendChart } from '@/components/dashboard/health-trend-chart'

export default async function AnalyticsPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const reposWithMetrics = await db.query.repositories.findMany({
    where: eq(repositories.userId, session.user.id),
    with: { metrics: true },
    columns: { id: true, name: true },
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

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Analytics</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Portfolio health trends and score breakdowns
        </p>
      </div>

      <HealthTrendChart data={chartData} />
    </div>
  )
}
