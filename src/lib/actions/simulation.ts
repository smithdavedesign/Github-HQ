'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { repositories, repositoryMetrics, securityFindings, deployments } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { toNum } from '@/lib/utils'
import { calculateOpportunityScore } from '@/lib/health/scoring'
import { runSimulation } from '@/lib/health/simulation'
import type { SimulationInput, SimulationResult, GoalType } from '@/lib/health/simulation'
import { getPortfolioScoreTrend } from '@/lib/health/portfolio-snapshot'

export type { SimulationResult, GoalType }

export async function runPortfolioSimulation(
  availableHours: number,
  goalType: GoalType,
): Promise<SimulationResult> {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const userId = session.user.id

  const [repos, scoreTrend] = await Promise.all([
    db.query.repositories.findMany({
      where: eq(repositories.userId, userId),
      with: {
        metrics: true,
        deployments: { columns: { status: true } },
        securityFindings: { where: eq(securityFindings.state, 'open') },
      },
      columns: {
        id: true, name: true, mrr: true, isRevenueGenerating: true,
        isArchived: true, lifecycleStatus: true, isFocused: true,
        estimatedEffort: true,
      },
    }),
    getPortfolioScoreTrend(userId),
  ])

  const inputs: SimulationInput[] = repos
    .filter(r => r.metrics != null && !r.isArchived)
    .map(r => {
      const m = r.metrics!
      const mrr = toNum(r.mrr)
      const hasLiveDeploy = r.deployments.some(d => d.status === 'healthy' || d.status === 'slow')
      const openCritical = r.securityFindings.filter(f => f.severity === 'critical' || f.severity === 'high').length

      const base = calculateOpportunityScore({
        healthScore: m.healthScore ?? 0,
        activityScore: m.activityScore ?? 0,
        stars: 0,
        mrr,
        isRevenueGenerating: r.isRevenueGenerating ?? false,
        hasLiveDeployment: hasLiveDeploy,
      })

      const withDeploy = hasLiveDeploy ? null : calculateOpportunityScore({
        healthScore: m.healthScore ?? 0, activityScore: m.activityScore ?? 0,
        stars: 0, mrr, isRevenueGenerating: r.isRevenueGenerating ?? false, hasLiveDeployment: true,
      }) - base

      const withSecurity = openCritical === 0 ? null : (() => {
        const newHealth = Math.min(100, (m.healthScore ?? 0) + openCritical * 5)
        return calculateOpportunityScore({
          healthScore: newHealth, activityScore: m.activityScore ?? 0,
          stars: 0, mrr, isRevenueGenerating: r.isRevenueGenerating ?? false, hasLiveDeployment: hasLiveDeploy,
        }) - base
      })()

      const withActivity = (m.activityScore ?? 0) >= 60 ? null : calculateOpportunityScore({
        healthScore: m.healthScore ?? 0, activityScore: 60,
        stars: 0, mrr, isRevenueGenerating: r.isRevenueGenerating ?? false, hasLiveDeployment: hasLiveDeploy,
      }) - base

      const withRevenue = mrr > 0 ? null : calculateOpportunityScore({
        healthScore: m.healthScore ?? 0, activityScore: m.activityScore ?? 0,
        stars: 0, mrr: 100, isRevenueGenerating: true, hasLiveDeployment: hasLiveDeploy,
      }) - base

      return {
        repoId: r.id,
        repoName: r.name,
        opportunityScore: m.opportunityScore ?? 0,
        healthScore: m.healthScore ?? 0,
        activityScore: m.activityScore ?? 0,
        mrr,
        isRevenueGenerating: r.isRevenueGenerating ?? false,
        hasLiveDeployment: hasLiveDeploy,
        openCriticalFindings: openCritical,
        estimatedEffort: r.estimatedEffort,
        lifecycleStatus: r.lifecycleStatus,
        isFocused: r.isFocused ?? false,
        withDeploy,
        withSecurity,
        withActivity,
        withRevenue,
      }
    })

  return runSimulation(inputs, availableHours, goalType, scoreTrend.current?.score ?? null)
}
