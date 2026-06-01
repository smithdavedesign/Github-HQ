import { toNum } from '@/lib/utils'
import { getDashboardStats, getRepositories, getOpportunityData, getLifecycleDistribution, getPortfolioValuation, getLatestAdvisorContent, getArchiveCandidates, getTimeAllocation, getLatestCeoReport, getConcentrationRisk, getProfileRecommendations, getShipItWarnings } from '@/lib/actions/repositories'
import { getPortfolioScoreTrend } from '@/lib/health/portfolio-snapshot'
import { getWeeklyDiff } from '@/lib/actions/weekly-diff'
import { MetricCard } from '@/components/dashboard/metric-card'
import { HealthBadge } from '@/components/repos/health-badge'
import { OpportunityPanel } from '@/components/dashboard/opportunity-panel'
import { LifecycleDistribution } from '@/components/dashboard/lifecycle-distribution'
import { AdvisorCard } from '@/components/dashboard/advisor-card'
import { PortfolioValuation } from '@/components/dashboard/portfolio-valuation'
import { GoalsCard } from '@/components/dashboard/goals-card'
import { ArchiveCandidatesCard } from '@/components/dashboard/archive-candidates-card'
import { CeoReportCard } from '@/components/dashboard/ceo-report-card'
import { PortfolioScoreCard } from '@/components/dashboard/portfolio-score-card'
import { WeeklyDiffCard } from '@/components/dashboard/weekly-diff-card'
import { ConcentrationRiskCard } from '@/components/dashboard/concentration-risk-card'
import { SimulationCard } from '@/components/dashboard/simulation-card'
import { ProfileOptimizerCard } from '@/components/dashboard/profile-optimizer-card'
import { ShipItCard } from '@/components/dashboard/ship-it-card'
import { getGoals } from '@/lib/actions/goals'
import { GitFork, Lock, Globe, Smile, AlertTriangle, Skull, Shield, Rocket, DollarSign, TrendingUp, TrendingDown, Banknote } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { redirect } from 'next/navigation'
import Link from 'next/link'

function SectionLabel({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-3 pt-2">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 shrink-0">
        {label}
      </p>
      <div className="flex-1 h-px bg-border/30" />
    </div>
  )
}

export default async function DashboardPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const [stats, repos, opportunity, lifecycleDistribution, valuation, advisor, activeGoals, archiveCandidates, timeAllocation, ceoReport, scoreTrend, weeklyDiff, concentrationRisk, profileRecommendations, userRecord, shipItWarnings] = await Promise.all([
    getDashboardStats(),
    getRepositories(),
    getOpportunityData(),
    getLifecycleDistribution(),
    getPortfolioValuation(),
    getLatestAdvisorContent(),
    getGoals(),
    getArchiveCandidates(),
    getTimeAllocation(),
    getLatestCeoReport(),
    getPortfolioScoreTrend(session.user.id),
    getWeeklyDiff(),
    getConcentrationRisk(),
    getProfileRecommendations(),
    db.query.users.findFirst({ where: eq(users.id, session.user.id), columns: { githubLogin: true, hoursPerWeek: true } }),
    getShipItWarnings(),
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

      {/* ── STATUS ────────────────────────────────────────────────── */}
      <SectionLabel label="Status" />

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

      {hasRevenue && (
        <div>
          <h2 className="text-sm font-medium text-muted-foreground mb-3">Portfolio P&amp;L</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <MetricCard title="Monthly Revenue" value={`$${stats.totalMrr.toFixed(0)}`} icon={DollarSign} variant="success" description={`${stats.revenueCount} revenue-generating repos`} />
            <MetricCard title="ARR" value={`$${stats.totalArr.toFixed(0)}`} icon={TrendingUp} variant="success" description="Annual recurring revenue" />
            <MetricCard title="Monthly Cost" value={`$${stats.totalCost.toFixed(0)}`} icon={Banknote} variant={stats.totalCost > 0 ? 'warning' : 'default'} description="Total infrastructure cost" />
            <MetricCard title="Monthly Profit" value={`$${stats.monthlyProfit.toFixed(0)}`} icon={stats.monthlyProfit >= 0 ? TrendingUp : TrendingDown} variant={stats.monthlyProfit >= 0 ? 'success' : 'danger'} description={stats.totalMrr > 0 ? `${Math.round((stats.monthlyProfit / stats.totalMrr) * 100)}% margin` : undefined} />
          </div>
        </div>
      )}

      {/* Ship It — alert, belongs in status zone */}
      <ShipItCard warnings={shipItWarnings} />

      {/* ── INTELLIGENCE ──────────────────────────────────────────── */}
      <SectionLabel label="Intelligence" />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {scoreTrend.current && (
          <PortfolioScoreCard breakdown={scoreTrend.current} weekDelta={scoreTrend.weekDelta} />
        )}
        <WeeklyDiffCard diff={weeklyDiff} />
        <ConcentrationRiskCard risk={concentrationRisk} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PortfolioValuation totalValue={valuation.totalValue} valuedRepos={valuation.valuedRepos} revenueValue={valuation.revenueValue} totalRepos={stats.total} />
        <LifecycleDistribution distribution={lifecycleDistribution} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <GoalsCard goals={activeGoals} />
        <AdvisorCard advisor={advisor} timeAllocation={timeAllocation} hoursPerWeek={userRecord?.hoursPerWeek ?? 10} />
      </div>

      <CeoReportCard report={ceoReport} />

      {profileRecommendations.length > 0 && (
        <ProfileOptimizerCard repos={profileRecommendations} githubLogin={userRecord?.githubLogin} />
      )}

      {/* ── PLANNING ──────────────────────────────────────────────── */}
      <SectionLabel label="Planning" />

      <SimulationCard defaultHours={userRecord?.hoursPerWeek ?? 10} />

      <OpportunityPanel needsAttention={opportunity.needsAttention} highPotentialDormant={opportunity.highPotentialDormant} />

      {archiveCandidates.length > 0 && (
        <ArchiveCandidatesCard candidates={archiveCandidates} />
      )}

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
                        {toNum(repo.mrr) > 0
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
