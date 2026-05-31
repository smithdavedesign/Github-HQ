import { getDashboardStats, getRepositories, getOpportunityData } from '@/lib/actions/repositories'
import { MetricCard } from '@/components/dashboard/metric-card'
import { HealthBadge } from '@/components/repos/health-badge'
import { WeeklyBriefing } from '@/components/dashboard/weekly-briefing'
import { OpportunityPanel } from '@/components/dashboard/opportunity-panel'
import { GitFork, Lock, Globe, Smile, AlertTriangle, Skull, Shield, Rocket, DollarSign, TrendingUp, TrendingDown, Banknote } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { getLatestDigest } from '@/lib/ai/digest'

export default async function DashboardPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const [stats, repos, digest, opportunity] = await Promise.all([
    getDashboardStats(),
    getRepositories(),
    getLatestDigest(session.user.id),
    getOpportunityData(),
  ])

  const topRepos = repos
    .filter((r) => r.metrics?.healthScore != null)
    .sort((a, b) => (b.metrics!.healthScore! - a.metrics!.healthScore!))
    .slice(0, 5)

  const hasRevenue = stats.totalMrr > 0

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Portfolio Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Overview of all {stats.total} repositories
        </p>
      </div>

      {/* Health metric cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 xl:grid-cols-8 gap-4">
        <MetricCard title="Total Repos" value={stats.total} icon={GitFork} />
        <MetricCard title="Private" value={stats.private} icon={Lock} />
        <MetricCard title="Public" value={stats.public} icon={Globe} />
        <MetricCard title="Healthy" value={stats.healthy} icon={Smile} variant="success" description="Score ≥ 90" />
        <MetricCard title="At Risk" value={stats.atRisk} icon={AlertTriangle} variant="warning" description="Score 70–89" />
        <MetricCard title="Dead" value={stats.dead} icon={Skull} variant="danger" description="Score < 70" />
        <MetricCard title="Security Issues" value={stats.securityIssues} icon={Shield} variant={stats.securityIssues > 0 ? 'danger' : 'default'} description="Critical + High" />
        <MetricCard
          title="Avg Health"
          value={stats.avgHealth ? `${Math.round(stats.avgHealth)}` : '—'}
          icon={Rocket}
          variant={stats.avgHealth >= 90 ? 'success' : stats.avgHealth >= 70 ? 'warning' : 'danger'}
        />
      </div>

      {/* P&L cards (Phase 3) — only shown when revenue data exists */}
      {hasRevenue && (
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-3">Portfolio P&amp;L</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <MetricCard
              title="Monthly Revenue"
              value={`$${stats.totalMrr.toFixed(0)}`}
              icon={DollarSign}
              variant="success"
              description={`${stats.revenueCount} revenue-generating repos`}
            />
            <MetricCard
              title="ARR"
              value={`$${stats.totalArr.toFixed(0)}`}
              icon={TrendingUp}
              variant="success"
              description="Annual recurring revenue"
            />
            <MetricCard
              title="Monthly Cost"
              value={`$${stats.totalCost.toFixed(0)}`}
              icon={Banknote}
              variant={stats.totalCost > 0 ? 'warning' : 'default'}
              description="Total infrastructure cost"
            />
            <MetricCard
              title="Monthly Profit"
              value={`$${stats.monthlyProfit.toFixed(0)}`}
              icon={stats.monthlyProfit >= 0 ? TrendingUp : TrendingDown}
              variant={stats.monthlyProfit >= 0 ? 'success' : 'danger'}
              description={stats.totalMrr > 0 ? `${Math.round((stats.monthlyProfit / stats.totalMrr) * 100)}% margin` : undefined}
            />
          </div>
        </div>
      )}

      {/* Opportunity Scoring (Phase 4) */}
      <OpportunityPanel
        needsAttention={opportunity.needsAttention}
        highPotentialDormant={opportunity.highPotentialDormant}
      />

      {/* Weekly AI Briefing */}
      {digest && <WeeklyBriefing digest={digest} />}

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
                  {hasRevenue && <th className="text-left font-medium text-muted-foreground px-3 py-3">MRR</th>}
                </tr>
              </thead>
              <tbody>
                {topRepos.map((repo) => (
                  <tr key={repo.id} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                    <td className="px-6 py-3 font-medium">
                      <Link href={`/repos/${repo.id}`} className="hover:underline">{repo.name}</Link>
                      <span className="ml-2 text-xs text-muted-foreground">{repo.visibility}</span>
                    </td>
                    <td className="px-3 py-3">
                      {repo.metrics?.healthScore != null && <HealthBadge score={repo.metrics.healthScore} />}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground text-xs">
                      {repo.metrics?.activityStatus ?? '—'}
                    </td>
                    <td className="px-3 py-3 text-muted-foreground text-xs">
                      {repo.techStack?.frontend ?? repo.techStack?.language ?? '—'}
                    </td>
                    {hasRevenue && (
                      <td className="px-3 py-3 text-xs">
                        {parseFloat(String(repo.mrr ?? '0')) > 0
                          ? <span className="text-emerald-600 font-medium">${parseFloat(String(repo.mrr)).toFixed(0)}</span>
                          : <span className="text-muted-foreground">—</span>}
                      </td>
                    )}
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
