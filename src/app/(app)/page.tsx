import { getDashboardStats, getRepositories } from '@/lib/actions/repositories'
import { MetricCard } from '@/components/dashboard/metric-card'
import { HealthBadge } from '@/components/repos/health-badge'
import { GitFork, Lock, Globe, Smile, AlertTriangle, Skull, Shield, Rocket } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import Link from 'next/link'

export default async function DashboardPage() {
  const [stats, repos] = await Promise.all([getDashboardStats(), getRepositories()])

  const topRepos = repos
    .filter((r) => r.metrics?.healthScore != null)
    .sort((a, b) => (b.metrics!.healthScore! - a.metrics!.healthScore!))
    .slice(0, 5)

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Portfolio Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Overview of all {stats.total} repositories
        </p>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-4">
        <MetricCard title="Total Repos" value={stats.total} icon={GitFork} />
        <MetricCard title="Private" value={stats.private} icon={Lock} />
        <MetricCard title="Public" value={stats.public} icon={Globe} />
        <MetricCard
          title="Healthy"
          value={stats.healthy}
          icon={Smile}
          variant="success"
          description="Score ≥ 90"
        />
        <MetricCard
          title="At Risk"
          value={stats.atRisk}
          icon={AlertTriangle}
          variant="warning"
          description="Score 70–89"
        />
        <MetricCard
          title="Dead"
          value={stats.dead}
          icon={Skull}
          variant="danger"
          description="Score < 70"
        />
        <MetricCard
          title="Security Issues"
          value={stats.securityIssues}
          icon={Shield}
          variant={stats.securityIssues > 0 ? 'danger' : 'default'}
          description="Critical + High"
        />
        <MetricCard
          title="Avg Health"
          value={stats.avgHealth ? `${Math.round(stats.avgHealth)}` : '—'}
          icon={Rocket}
          variant={
            stats.avgHealth >= 90 ? 'success'
            : stats.avgHealth >= 70 ? 'warning'
            : 'danger'
          }
        />
      </div>

      {/* Top repos */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Top Repositories</CardTitle>
            <Link href="/repos" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
              View all →
            </Link>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {topRepos.length === 0 ? (
            <div className="px-6 pb-6 text-sm text-muted-foreground">
              No repositories yet.{' '}
              <span className="underline cursor-pointer">Sync to get started.</span>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left font-medium text-muted-foreground px-6 py-3">Repo</th>
                  <th className="text-left font-medium text-muted-foreground px-3 py-3">Health</th>
                  <th className="text-left font-medium text-muted-foreground px-3 py-3">Activity</th>
                  <th className="text-left font-medium text-muted-foreground px-3 py-3">Stack</th>
                </tr>
              </thead>
              <tbody>
                {topRepos.map((repo) => (
                  <tr key={repo.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                    <td className="px-6 py-3 font-medium">
                      <Link href={`/repos/${repo.id}`} className="hover:underline">
                        {repo.name}
                      </Link>
                      <span className="ml-2 text-xs text-muted-foreground">{repo.visibility}</span>
                    </td>
                    <td className="px-3 py-3">
                      {repo.metrics?.healthScore != null && (
                        <HealthBadge score={repo.metrics.healthScore} />
                      )}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground text-xs">
                      {repo.metrics?.activityStatus ?? '—'}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground text-xs">
                      {repo.techStack?.frontend ?? repo.techStack?.language ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
