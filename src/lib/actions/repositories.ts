'use server'

import { auth } from '@/lib/auth'
import { toNum } from '@/lib/utils'
import { db } from '@/lib/db'
import { repositories, repositoryMetrics, techStack, deployments, securityFindings } from '@/lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'

export async function getRepositories() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const rows = await db.query.repositories.findMany({
    where: eq(repositories.userId, session.user.id),
    with: {
      metrics: true,
      techStack: true,
      deployments: true,
      securityFindings: {
        where: eq(securityFindings.state, 'open'),
      },
    },
  })

  // Sort by health score descending (health score lives on the related metrics table,
  // not on repositories, so ORDER BY in the lateral-join query won't work)
  return rows.sort((a, b) => (b.metrics?.healthScore ?? -1) - (a.metrics?.healthScore ?? -1))
}

export async function getRepositoryById(id: number) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  return db.query.repositories.findFirst({
    where: and(eq(repositories.id, id), eq(repositories.userId, session.user.id)),
    with: {
      metrics: true,
      techStack: true,
      deployments: true,
      securityFindings: true,
    },
  })
}

export async function getDashboardStats() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const userId = session.user.id

  const [repoStats, securityStats, revenueStats] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)`.mapWith(Number),
        private: sql<number>`count(*) filter (where ${repositories.visibility} = 'private')`.mapWith(Number),
        public: sql<number>`count(*) filter (where ${repositories.visibility} = 'public')`.mapWith(Number),
        healthy: sql<number>`count(*) filter (where ${repositoryMetrics.healthScore} >= 90)`.mapWith(Number),
        atRisk: sql<number>`count(*) filter (where ${repositoryMetrics.healthScore} >= 70 and ${repositoryMetrics.healthScore} < 90)`.mapWith(Number),
        dead: sql<number>`count(*) filter (where ${repositoryMetrics.healthScore} < 70)`.mapWith(Number),
        avgHealth: sql<number>`avg(${repositoryMetrics.healthScore})`.mapWith(Number),
      })
      .from(repositories)
      .leftJoin(repositoryMetrics, eq(repositories.id, repositoryMetrics.repoId))
      .where(eq(repositories.userId, userId)),

    db
      .select({
        critical: sql<number>`count(*) filter (where ${securityFindings.severity} = 'critical' and ${securityFindings.state} = 'open')`.mapWith(Number),
        high: sql<number>`count(*) filter (where ${securityFindings.severity} = 'high' and ${securityFindings.state} = 'open')`.mapWith(Number),
      })
      .from(securityFindings)
      .innerJoin(repositories, eq(securityFindings.repoId, repositories.id))
      .where(eq(repositories.userId, userId)),

    db
      .select({
        totalMrr: sql<number>`coalesce(sum(${repositories.mrr}::numeric), 0)`.mapWith(Number),
        totalCost: sql<number>`coalesce(sum(${repositories.monthlyCost}::numeric), 0)`.mapWith(Number),
        revenueCount: sql<number>`count(*) filter (where ${repositories.isRevenueGenerating} = true)`.mapWith(Number),
      })
      .from(repositories)
      .where(eq(repositories.userId, userId)),
  ])

  const totalMrr = revenueStats[0]?.totalMrr ?? 0
  const totalCost = revenueStats[0]?.totalCost ?? 0

  return {
    ...repoStats[0],
    securityIssues: (securityStats[0]?.critical ?? 0) + (securityStats[0]?.high ?? 0),
    totalMrr,
    totalArr: totalMrr * 12,
    totalCost,
    monthlyProfit: totalMrr - totalCost,
    revenueCount: revenueStats[0]?.revenueCount ?? 0,
  }
}

export async function toggleRevenueGenerating(repoId: number, value: boolean) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  await db
    .update(repositories)
    .set({ isRevenueGenerating: value })
    .where(and(eq(repositories.id, repoId), eq(repositories.userId, session.user.id)))
}

export async function updateRepoRevenue(repoId: number, data: { mrr?: string; arr?: string; monthlyCost?: string }) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  await db
    .update(repositories)
    .set({
      mrr: data.mrr ?? undefined,
      arr: data.arr ?? undefined,
      monthlyCost: data.monthlyCost ?? undefined,
      isRevenueGenerating: parseFloat(data.mrr ?? '0') > 0 || parseFloat(data.arr ?? '0') > 0,
    })
    .where(and(eq(repositories.id, repoId), eq(repositories.userId, session.user.id)))
}

export async function updateLifecycleStatus(repoId: number, status: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  await db
    .update(repositories)
    .set({ lifecycleStatus: status })
    .where(and(eq(repositories.id, repoId), eq(repositories.userId, session.user.id)))

  const { revalidatePath } = await import('next/cache')
  revalidatePath(`/repos/${repoId}`)
  revalidatePath('/repos')
  revalidatePath('/')
}

export async function updateAbandonmentReason(repoId: number, reason: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  await db.update(repositories).set({ abandonmentReason: reason })
    .where(and(eq(repositories.id, repoId), eq(repositories.userId, session.user.id)))
}

export async function updateRepoTags(repoId: number, tags: string[]) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  await db
    .update(repositories)
    .set({ tags })
    .where(and(eq(repositories.id, repoId), eq(repositories.userId, session.user.id)))
}

export async function getPortfolioCostBreakdown() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const repos = await db.query.repositories.findMany({
    where: eq(repositories.userId, session.user.id),
    columns: { costItems: true, monthlyCost: true, name: true },
  })

  // Aggregate cost_items labels across all repos
  const breakdown: Record<string, number> = {}
  let totalFromItems = 0

  for (const repo of repos) {
    const items = repo.costItems as Array<{ label: string; amount: number }> | null
    if (items && items.length > 0) {
      for (const item of items) {
        breakdown[item.label] = (breakdown[item.label] ?? 0) + item.amount
        totalFromItems += item.amount
      }
    } else if (repo.monthlyCost && parseFloat(String(repo.monthlyCost)) > 0) {
      // Fall back to unlabelled cost
      const amt = parseFloat(String(repo.monthlyCost))
      breakdown['Other'] = (breakdown['Other'] ?? 0) + amt
      totalFromItems += amt
    }
  }

  return {
    breakdown: Object.entries(breakdown)
      .map(([label, amount]) => ({ label, amount: Math.round(amount * 100) / 100 }))
      .sort((a, b) => b.amount - a.amount),
    total: Math.round(totalFromItems * 100) / 100,
  }
}

export async function getPortfolioValuation() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const rows = await db
    .select({
      totalValue: sql<number>`coalesce(sum(${repositoryMetrics.estimatedValue}), 0)`.mapWith(Number),
      valuedRepos: sql<number>`count(*) filter (where ${repositoryMetrics.estimatedValue} > 0)`.mapWith(Number),
      revenueValue: sql<number>`coalesce(sum(${repositoryMetrics.estimatedValue}) filter (where ${repositoryMetrics.valuationMethod} = 'saas_multiple'), 0)`.mapWith(Number),
    })
    .from(repositoryMetrics)
    .innerJoin(repositories, eq(repositories.id, repositoryMetrics.repoId))
    .where(eq(repositories.userId, session.user.id))

  return rows[0] ?? { totalValue: 0, valuedRepos: 0, revenueValue: 0 }
}

export async function triggerAdvisor() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const { after } = await import('next/server')
  const { generateAdvisor } = await import('@/lib/ai/advisor')
  const { revalidatePath } = await import('next/cache')
  const userId = session.user.id

  after(async () => {
    await generateAdvisor(userId)
    revalidatePath('/')
  })
}

export async function getLatestAdvisorContent() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  const { getLatestAdvisor } = await import('@/lib/ai/advisor')
  return getLatestAdvisor(session.user.id)
}

export async function getLifecycleDistribution() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const rows = await db
    .select({ status: repositories.lifecycleStatus, count: sql<number>`count(*)`.mapWith(Number) })
    .from(repositories)
    .where(eq(repositories.userId, session.user.id))
    .groupBy(repositories.lifecycleStatus)

  return rows.reduce<Record<string, number>>((acc, r) => {
    acc[r.status ?? 'maintaining'] = r.count
    return acc
  }, {})
}

export async function getOpportunityData() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const userId = session.user.id

  const allRepos = await db.query.repositories.findMany({
    where: eq(repositories.userId, userId),
    with: { metrics: true },
    columns: {
      id: true, name: true, description: true, stars: true,
      mrr: true, isRevenueGenerating: true,
    },
  })

  type RepoSummary = {
    id: number
    name: string
    description: string | null
    opportunityScore: number
    healthScore: number
    activityStatus: string | null
    stars: number
    mrr: string | null
    isRevenueGenerating: boolean | null
  }

  const withScores = allRepos
    .filter(r => r.metrics?.opportunityScore != null)
    .map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      opportunityScore: Math.round(r.metrics!.opportunityScore ?? 0),
      healthScore: Math.round(r.metrics!.healthScore ?? 0),
      activityStatus: r.metrics!.activityStatus,
      stars: r.stars ?? 0,
      mrr: String(r.mrr ?? '0'),
      isRevenueGenerating: r.isRevenueGenerating,
    })) as RepoSummary[]

  const OPPORTUNITY_THRESHOLD = 10  // top relative to this portfolio

  // Sort descending by opportunity score to find the threshold dynamically
  const sorted = [...withScores].sort((a, b) => b.opportunityScore - a.opportunityScore)
  const top25pctScore = sorted[Math.floor(sorted.length * 0.25)]?.opportunityScore ?? 0
  const threshold = Math.max(OPPORTUNITY_THRESHOLD, top25pctScore)

  const needsAttention = withScores
    .filter(r => r.opportunityScore >= threshold && r.healthScore < 70)
    .sort((a, b) => b.opportunityScore - a.opportunityScore)
    .slice(0, 5)

  const needsAttentionIds = new Set(needsAttention.map(r => r.id))

  const highPotentialDormant = withScores
    .filter(r =>
      r.opportunityScore >= threshold &&
      (r.activityStatus === 'Dormant' || r.activityStatus === 'Abandoned' || r.activityStatus === 'Low Activity') &&
      !needsAttentionIds.has(r.id)
    )
    .sort((a, b) => b.opportunityScore - a.opportunityScore)
    .slice(0, 5)

  return { needsAttention, highPotentialDormant }
}

export async function updateRepoEffort(repoId: number, effort: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  await db.update(repositories).set({ estimatedEffort: effort })
    .where(and(eq(repositories.id, repoId), eq(repositories.userId, session.user.id)))
  const { revalidatePath } = await import('next/cache')
  revalidatePath(`/repos/${repoId}`)
  revalidatePath('/analytics')
}

export async function updateHoursPerWeek(hours: number) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  const { users } = await import('@/lib/db/schema')
  await db.update(users).set({ hoursPerWeek: hours }).where(eq(users.id, session.user.id))
}

export async function togglePublicProfile(enabled: boolean) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const { users } = await import('@/lib/db/schema')
  await db.update(users).set({ publicProfile: enabled }).where(eq(users.id, session.user.id))
}

export async function analyzeRepo(repoId: number) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  // Verify ownership
  const repo = await db.query.repositories.findFirst({
    where: and(eq(repositories.id, repoId), eq(repositories.userId, session.user.id)),
    columns: { id: true },
  })
  if (!repo) throw new Error('Not found')

  const { after } = await import('next/server')
  const { analyzeRepository } = await import('@/lib/ai/analysis')
  const { revalidatePath } = await import('next/cache')

  after(async () => {
    await analyzeRepository(repoId)
    revalidatePath(`/repos/${repoId}`)
  })
}

export async function resyncRepo(repoId: number) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const { after } = await import('next/server')
  const { syncSingleRepo } = await import('@/lib/github/sync')
  const { users } = await import('@/lib/db/schema')

  const [user, repo] = await Promise.all([
    db.query.users.findFirst({ where: eq(users.id, session.user.id), columns: { githubToken: true } }),
    db.query.repositories.findFirst({ where: and(eq(repositories.id, repoId), eq(repositories.userId, session.user.id)) }),
  ])

  if (!user?.githubToken || !repo) throw new Error('Not found')

  const token = user.githubToken
  const githubRepoStub = {
    id: repo.githubId,
    name: repo.name,
    full_name: repo.fullName,
    owner: { login: repo.owner },
    visibility: repo.visibility,
    private: repo.visibility === 'private',
    description: repo.description,
    default_branch: repo.defaultBranch,
    homepage: repo.homepage,
    stargazers_count: repo.stars,
    forks_count: repo.forks,
    language: repo.language,
    archived: repo.isArchived,
    fork: repo.isFork,
    pushed_at: repo.updatedAt?.toISOString(),
    created_at: repo.createdAt?.toISOString(),
    updated_at: repo.updatedAt?.toISOString(),
  }

  after(async () => {
    await syncSingleRepo(session.user.id, token, githubRepoStub)
    const { revalidatePath } = await import('next/cache')
    revalidatePath(`/repos/${repoId}`)
  })
}

// ─── Phase 21: Purpose & Focus ────────────────────────────────────────────────

export async function updateRepoPurpose(repoId: number, purpose: string | null) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  await db
    .update(repositories)
    .set({ purpose })
    .where(and(eq(repositories.id, repoId), eq(repositories.userId, session.user.id)))

  const { revalidatePath } = await import('next/cache')
  revalidatePath(`/repos/${repoId}`)
  revalidatePath('/repos')
}

export async function toggleFocused(repoId: number, isFocused: boolean) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  await db
    .update(repositories)
    .set({ isFocused })
    .where(and(eq(repositories.id, repoId), eq(repositories.userId, session.user.id)))

  const { revalidatePath } = await import('next/cache')
  revalidatePath(`/repos/${repoId}`)
  revalidatePath('/repos')
  revalidatePath('/')
}

// ─── Phase 22: Archive Candidates ────────────────────────────────────────────

export async function getArchiveCandidates(threshold = 70) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const rows = await db.query.repositories.findMany({
    where: eq(repositories.userId, session.user.id),
    with: { metrics: true },
    columns: { id: true, name: true, description: true, lifecycleStatus: true, mrr: true },
  })

  return rows
    .filter(r =>
      (r.metrics?.archiveScore ?? 0) >= threshold &&
      r.lifecycleStatus !== 'archived',
    )
    .map(r => ({
      id: r.id,
      name: r.name,
      description: r.description,
      archiveScore: Math.round(r.metrics?.archiveScore ?? 0),
      lifecycleStatus: r.lifecycleStatus,
    }))
    .sort((a, b) => b.archiveScore - a.archiveScore)
    .slice(0, 8)
}

// ─── Phase 23: Itemised Cost Tracking ────────────────────────────────────────

export async function updateCostItems(
  repoId: number,
  costItems: Array<{ label: string; amount: number }>,
) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  // Derive totalMonthlyCost from line items
  const total = costItems.reduce((sum, item) => sum + item.amount, 0)

  await db
    .update(repositories)
    .set({ costItems, monthlyCost: String(total) })
    .where(and(eq(repositories.id, repoId), eq(repositories.userId, session.user.id)))

  const { revalidatePath } = await import('next/cache')
  revalidatePath(`/repos/${repoId}`)
  revalidatePath('/')
}

// ─── Phase 24: CEO Report ────────────────────────────────────────────────────

export async function triggerCeoReport() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const { after } = await import('next/server')
  const { generateCeoReport } = await import('@/lib/ai/ceo-report')
  const { revalidatePath } = await import('next/cache')
  const userId = session.user.id

  after(async () => {
    await generateCeoReport(userId)
    revalidatePath('/')
  })
}

export async function getLatestCeoReport() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  const { getLatestCeoReport: fetchLatest } = await import('@/lib/ai/ceo-report')
  return fetchLatest(session.user.id)
}

// ─── Phase 25: Time Allocation ────────────────────────────────────────────────

export async function getTimeAllocation(topN = 3) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const { calculateTimeAllocation } = await import('@/lib/health/scoring')

  const rows = await db.query.repositories.findMany({
    where: eq(repositories.userId, session.user.id),
    with: { metrics: true, deployments: true },
    columns: {
      id: true, name: true, mrr: true, isFocused: true,
    },
  })

  const inputs = rows
    .filter(r => r.metrics != null)
    .map(r => ({
      repoId: r.id,
      repoName: r.name,
      opportunityScore: r.metrics!.opportunityScore ?? 0,
      healthScore: r.metrics!.healthScore ?? 0,
      estimatedValue: r.metrics!.estimatedValue ?? 0,
      isFocused: r.isFocused ?? false,
      mrr: toNum(r.mrr),
      hasLiveDeployment: r.deployments.some(d => d.status !== 'down'),
      activityScore: r.metrics!.activityScore ?? 0,
      archiveScore: r.metrics!.archiveScore ?? 0,
    }))

  return calculateTimeAllocation(inputs, topN)
}
