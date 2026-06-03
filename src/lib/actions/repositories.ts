'use server'

import { cache } from 'react'
import { auth } from '@/lib/auth'
import { toNum } from '@/lib/utils'
import { db } from '@/lib/db'
import { repositories, repositoryMetrics, techStack, deployments, securityFindings } from '@/lib/db/schema'
import { eq, and, sql, inArray, desc } from 'drizzle-orm'
import { portfolioEvents } from '@/lib/db/schema'

/**
 * Wraps DB calls in server actions so raw Neon/Drizzle errors are caught,
 * logged server-side, and surfaced as clean user-facing messages.
 * Auth errors (Unauthorized / Not found) pass through unchanged.
 */
async function dbOp<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof Error && ['Unauthorized', 'Not found', 'Repository not found'].includes(err.message)) {
      throw err
    }
    console.error(`[repositories/${label}]`, err instanceof Error ? err.message : err)
    throw new Error(`Failed to ${label}. Please try again.`)
  }
}

export const getRepositories = cache(async function getRepositories() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  return dbOp('load repositories', async () => {
    const rows = await db.query.repositories.findMany({
      where: eq(repositories.userId, session.user.id),
      with: {
        metrics: true,
        techStack: true,
        deployments: true,
        securityFindings: { where: eq(securityFindings.state, 'open') },
      },
    })
    return rows.sort((a, b) => (b.metrics?.healthScore ?? -1) - (a.metrics?.healthScore ?? -1))
  })
})

/** Lightweight version for the dashboard top-5 table — avoids overfetching deployments + security findings */
export async function getRepositoriesSlim() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  return dbOp('load repositories slim', async () => {
    const rows = await db.query.repositories.findMany({
      where: eq(repositories.userId, session.user.id),
      columns: { id: true, name: true, visibility: true, mrr: true },
      with: {
        metrics: { columns: { healthScore: true, activityStatus: true } },
        techStack: { columns: { frontend: true, language: true } },
      },
    })
    return rows.sort((a, b) => (b.metrics?.healthScore ?? -1) - (a.metrics?.healthScore ?? -1))
  })
}

export async function getRepositoryById(id: number) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  return dbOp('load repository', () =>
    db.query.repositories.findFirst({
      where: and(eq(repositories.id, id), eq(repositories.userId, session.user.id)),
      with: { metrics: true, techStack: true, deployments: true, securityFindings: true },
    })
  )
}

export const getDashboardStats = cache(async function getDashboardStats() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const userId = session.user.id

  return dbOp('load dashboard stats', async () => {
  const [repoStats, securityStats, revenueStats] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)`.mapWith(Number),
        private: sql<number>`count(*) filter (where ${repositories.visibility} = 'private')`.mapWith(Number),
        public: sql<number>`count(*) filter (where ${repositories.visibility} = 'public')`.mapWith(Number),
        healthy: sql<number>`count(*) filter (where ${repositoryMetrics.healthScore} >= 75)`.mapWith(Number),
        atRisk: sql<number>`count(*) filter (where ${repositoryMetrics.healthScore} >= 55 and ${repositoryMetrics.healthScore} < 75)`.mapWith(Number),
        dead: sql<number>`count(*) filter (where ${repositoryMetrics.healthScore} < 55)`.mapWith(Number),
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
  }) // end dbOp
})

export async function toggleRevenueGenerating(repoId: number, value: boolean) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  await dbOp('toggle revenue', () =>
    db.update(repositories)
      .set({ isRevenueGenerating: value })
      .where(and(eq(repositories.id, repoId), eq(repositories.userId, session.user.id)))
  )
}

export async function updateRepoRevenue(repoId: number, data: { mrr?: string; arr?: string; monthlyCost?: string }) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  await dbOp('update revenue', () =>
    db.update(repositories)
      .set({
        mrr: data.mrr ?? undefined,
        arr: data.arr ?? undefined,
        monthlyCost: data.monthlyCost ?? undefined,
        isRevenueGenerating: parseFloat(data.mrr ?? '0') > 0 || parseFloat(data.arr ?? '0') > 0,
      })
      .where(and(eq(repositories.id, repoId), eq(repositories.userId, session.user.id)))
  )
}

export async function updateLifecycleStatus(repoId: number, status: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  await dbOp('update lifecycle', () =>
    db.update(repositories)
      .set({ lifecycleStatus: status })
      .where(and(eq(repositories.id, repoId), eq(repositories.userId, session.user.id)))
  )

  const { revalidatePath } = await import('next/cache')
  revalidatePath(`/repos/${repoId}`)
  revalidatePath('/repos')
  revalidatePath('/')
}

export async function archiveRepoOnGitHub(repoId: number): Promise<{ alreadyArchived?: boolean }> {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const { users: usersTable } = await import('@/lib/db/schema')
  const { portfolioEvents: portfolioEventsTable } = await import('@/lib/db/schema')

  const [repo, user] = await Promise.all([
    db.query.repositories.findFirst({
      where: and(eq(repositories.id, repoId), eq(repositories.userId, session.user.id)),
      columns: { id: true, name: true, owner: true, isArchived: true },
    }),
    db.query.users.findFirst({
      where: eq(usersTable.id, session.user.id),
      columns: { githubToken: true },
    }),
  ])

  if (!repo) throw new Error('Not found')
  if (repo.isArchived) return { alreadyArchived: true }
  if (!user?.githubToken) throw new Error('No GitHub token')

  const { createOctokit } = await import('@/lib/github/client')
  const octokit = createOctokit(user.githubToken)

  await octokit.rest.repos.update({ owner: repo.owner, repo: repo.name, archived: true })

  await Promise.all([
    db.update(repositories)
      .set({ isArchived: true, lifecycleStatus: 'archived' })
      .where(eq(repositories.id, repoId)),
    db.insert(portfolioEventsTable).values({
      userId: session.user.id,
      repoId,
      eventType: 'repo_archived',
      title: `${repo.name} archived on GitHub`,
      description: 'Set to read-only via RepoHQ one-click pipeline',
    }).onConflictDoNothing(),
  ])

  const { revalidatePath } = await import('next/cache')
  revalidatePath('/repos/graveyard')
  revalidatePath('/repos')

  return {}
}

/** Lightweight lifecycle update for triage mode — no revalidatePath to avoid resetting triage state */
export async function triageSetLifecycle(repoId: number, status: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  await dbOp('update lifecycle (triage)', () =>
    db.update(repositories)
      .set({ lifecycleStatus: status })
      .where(and(eq(repositories.id, repoId), eq(repositories.userId, session.user.id)))
  )
}

export async function updateAbandonmentReason(repoId: number, reason: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  await dbOp('update abandonment reason', () =>
    db.update(repositories).set({ abandonmentReason: reason })
      .where(and(eq(repositories.id, repoId), eq(repositories.userId, session.user.id)))
  )
}

export async function updateRepoTags(repoId: number, tags: string[]) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  await dbOp('update tags', () =>
    db.update(repositories)
      .set({ tags })
      .where(and(eq(repositories.id, repoId), eq(repositories.userId, session.user.id)))
  )
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
    .filter(r => r.opportunityScore >= threshold && r.healthScore < 75)
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

  await dbOp('update effort', () =>
    db.update(repositories).set({ estimatedEffort: effort })
      .where(and(eq(repositories.id, repoId), eq(repositories.userId, session.user.id)))
  )
  const { revalidatePath } = await import('next/cache')
  revalidatePath(`/repos/${repoId}`)
  revalidatePath('/analytics')
}

export async function updateHoursPerWeek(hours: number) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  const { users } = await import('@/lib/db/schema')
  await dbOp('update hours per week', () =>
    db.update(users).set({ hoursPerWeek: hours }).where(eq(users.id, session.user.id))
  )
}

export async function togglePublicProfile(enabled: boolean) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const { users } = await import('@/lib/db/schema')
  await dbOp('toggle public profile', () =>
    db.update(users).set({ publicProfile: enabled }).where(eq(users.id, session.user.id))
  )
}

export async function analyzeRepo(repoId: number, force = false) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const repo = await db.query.repositories.findFirst({
    where: and(eq(repositories.id, repoId), eq(repositories.userId, session.user.id)),
    with: { metrics: { columns: { lastPush: true } } },
    columns: { id: true, claudeAnalysisAt: true, claudeAnalysis: true },
  })
  if (!repo) throw new Error('Not found')

  // Skip if analysis is more recent than the last push — nothing changed
  if (!force && repo.claudeAnalysis && repo.claudeAnalysisAt && repo.metrics?.lastPush) {
    if (repo.claudeAnalysisAt >= repo.metrics.lastPush) {
      return { fromCache: true }
    }
  }

  const { after } = await import('next/server')
  const { analyzeRepository } = await import('@/lib/ai/analysis')
  const { revalidatePath } = await import('next/cache')

  after(async () => {
    await analyzeRepository(repoId)
    revalidatePath(`/repos/${repoId}`)
  })

  return { fromCache: false }
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

  await dbOp('update purpose', () =>
    db.update(repositories)
      .set({ purpose })
      .where(and(eq(repositories.id, repoId), eq(repositories.userId, session.user.id)))
  )
  const { revalidatePath } = await import('next/cache')
  revalidatePath(`/repos/${repoId}`)
  revalidatePath('/repos')
}

export async function toggleFocused(repoId: number, isFocused: boolean) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  await dbOp('toggle focused', () =>
    db.update(repositories)
      .set({ isFocused })
      .where(and(eq(repositories.id, repoId), eq(repositories.userId, session.user.id)))
  )
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
    columns: { id: true, name: true, description: true, lifecycleStatus: true, mrr: true, purpose: true },
  })

  return rows
    .filter(r =>
      (r.metrics?.archiveScore ?? 0) >= threshold &&
      r.lifecycleStatus !== 'archived' &&
      r.purpose !== 'Reference',   // Reference repos are intentionally dormant
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

export interface ConcentrationRisk {
  totalMrr: number
  topRevenueRepo: { id: number; name: string; mrr: number; healthScore: number; pct: number } | null
  revenueRiskLevel: 'none' | 'low' | 'medium' | 'high'
  revenueRepoCount: number
  dominantStack: { framework: string; count: number; pct: number } | null
}

export async function getConcentrationRisk(): Promise<ConcentrationRisk> {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const userId = session.user.id

  const rows = await db.query.repositories.findMany({
    where: eq(repositories.userId, userId),
    with: {
      metrics: { columns: { healthScore: true } },
      techStack: { columns: { frontend: true } },
    },
    columns: { id: true, name: true, mrr: true, isArchived: true },
  })

  const active = rows.filter(r => !r.isArchived)
  const totalMrr = active.reduce((sum, r) => sum + toNum(r.mrr), 0)

  // Revenue concentration
  const revenueRepos = active
    .map(r => ({ ...r, mrrNum: toNum(r.mrr) }))
    .filter(r => r.mrrNum > 0)
    .sort((a, b) => b.mrrNum - a.mrrNum)

  const top = revenueRepos[0] ?? null
  const topPct = totalMrr > 0 && top ? Math.round((top.mrrNum / totalMrr) * 100) : 0

  const revenueRiskLevel: ConcentrationRisk['revenueRiskLevel'] =
    totalMrr === 0 ? 'none'
    : topPct >= 80 ? 'high'
    : topPct >= 60 ? 'medium'
    : 'low'

  const topRevenueRepo = top ? {
    id: top.id,
    name: top.name,
    mrr: top.mrrNum,
    healthScore: Math.round(top.metrics?.healthScore ?? 0),
    pct: topPct,
  } : null

  // Stack concentration — dominant frontend framework across active repos
  const frameworkCounts = new Map<string, number>()
  for (const r of active) {
    const fw = r.techStack?.frontend
    if (fw) frameworkCounts.set(fw, (frameworkCounts.get(fw) ?? 0) + 1)
  }
  const topFramework = [...frameworkCounts.entries()].sort((a, b) => b[1] - a[1])[0]
  const dominantStack = topFramework ? {
    framework: topFramework[0],
    count: topFramework[1],
    pct: Math.round((topFramework[1] / active.length) * 100),
  } : null

  return {
    totalMrr,
    topRevenueRepo,
    revenueRiskLevel,
    revenueRepoCount: revenueRepos.length,
    dominantStack,
  }
}

export interface ShipItWarning {
  repoId: number
  repoName: string
  daysSinceCommit: number
  opportunityScore: number
  lifecycleStatus: string | null
}

export async function getShipItWarnings(thresholdDays = 7): Promise<ShipItWarning[]> {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const cutoff = new Date(Date.now() - thresholdDays * 86400_000)

  const rows = await db.query.repositories.findMany({
    where: and(
      eq(repositories.userId, session.user.id),
      eq(repositories.isFocused, true),
    ),
    with: { metrics: { columns: { weeklyCommits: true, lastPush: true, opportunityScore: true } } },
    columns: { id: true, name: true, lifecycleStatus: true, isArchived: true },
  })

  return rows
    .filter(r => {
      if (r.isArchived) return false
      if (['archived', 'sunsetting'].includes(r.lifecycleStatus ?? '')) return false
      if ((r.metrics?.weeklyCommits ?? 0) > 0) return false
      const lastPush = r.metrics?.lastPush
      if (!lastPush) return true
      return new Date(lastPush) < cutoff
    })
    .map(r => {
      const lastPush = r.metrics?.lastPush
      const daysSince = lastPush
        ? Math.floor((Date.now() - new Date(lastPush).getTime()) / 86400_000)
        : 999
      return {
        repoId: r.id,
        repoName: r.name,
        daysSinceCommit: daysSince,
        opportunityScore: Math.round(r.metrics?.opportunityScore ?? 0),
        lifecycleStatus: r.lifecycleStatus,
      }
    })
    .sort((a, b) => b.daysSinceCommit - a.daysSinceCommit)
    .slice(0, 3)
}

export async function getOpportunityCost() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const { computeOpportunityCost } = await import('@/lib/health/opportunity-cost')

  const rows = await db.query.repositories.findMany({
    where: eq(repositories.userId, session.user.id),
    with: { metrics: { columns: { opportunityScore: true, weeklyCommits: true } } },
    columns: { id: true, name: true, mrr: true, isFocused: true, lifecycleStatus: true, purpose: true },
  })

  const inputs = rows
    .filter(r => r.metrics != null && r.purpose !== 'Reference')
    .map(r => ({
      id: r.id,
      name: r.name,
      opportunityScore: r.metrics!.opportunityScore ?? 0,
      weeklyCommits: r.metrics!.weeklyCommits ?? 0,
      mrr: toNum(r.mrr),
      isFocused: r.isFocused ?? false,
      lifecycleStatus: r.lifecycleStatus,
    }))

  return computeOpportunityCost(inputs)
}

export async function getProfileRecommendations() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const { getShowcaseRecommendations } = await import('@/lib/health/showcase')

  const rows = await db.query.repositories.findMany({
    where: eq(repositories.userId, session.user.id),
    with: {
      metrics: { columns: { healthScore: true, activityStatus: true } },
      deployments: { columns: { status: true } },
    },
    columns: {
      id: true, name: true, description: true, visibility: true,
      stars: true, isFocused: true, purpose: true,
      lifecycleStatus: true, language: true,
    },
  })

  const inputs = rows.map(r => ({
    id: r.id,
    name: r.name,
    description: r.description,
    visibility: r.visibility,
    stars: r.stars ?? 0,
    healthScore: r.metrics?.healthScore ?? 0,
    isFocused: r.isFocused ?? false,
    hasDeployment: r.deployments.some(d => d.status === 'healthy' || d.status === 'slow'),
    purpose: r.purpose,
    lifecycleStatus: r.lifecycleStatus,
    activityStatus: r.metrics?.activityStatus ?? null,
    language: r.language,
  }))

  return getShowcaseRecommendations(inputs, 6)
}

export async function getOpenAgentPRsByRepo(): Promise<Record<number, { prUrl: string; taskId: string }>> {
  const session = await auth()
  if (!session?.user?.id) return {}

  const events = await db.query.portfolioEvents.findMany({
    where: and(
      eq(portfolioEvents.userId, session.user.id),
      inArray(portfolioEvents.eventType, ['agent_pr_created', 'agent_pr_merged']),
    ),
    columns: { repoId: true, eventType: true, metadata: true },
    orderBy: [desc(portfolioEvents.occurredAt)],
  })

  const mergedTaskIds = new Set<string>()
  for (const e of events) {
    if (e.eventType === 'agent_pr_merged') {
      const meta = e.metadata as { taskId?: string } | null
      if (meta?.taskId) mergedTaskIds.add(meta.taskId)
    }
  }

  const result: Record<number, { prUrl: string; taskId: string }> = {}
  for (const e of events) {
    if (e.eventType === 'agent_pr_created' && e.repoId != null) {
      const meta = e.metadata as { taskId?: string; prUrl?: string } | null
      if (meta?.taskId && !mergedTaskIds.has(meta.taskId) && !(e.repoId in result)) {
        result[e.repoId] = { prUrl: meta.prUrl ?? '', taskId: meta.taskId }
      }
    }
  }

  return result
}

export async function getAgentStats() {
  const session = await auth()
  if (!session?.user?.id) return null

  const events = await db.query.portfolioEvents.findMany({
    where: and(
      eq(portfolioEvents.userId, session.user.id),
      inArray(portfolioEvents.eventType, [
        'agent_task_queued', 'agent_pr_created', 'agent_pr_merged', 'agent_execution_failed',
      ]),
    ),
    columns: { eventType: true, metadata: true, occurredAt: true },
    orderBy: [desc(portfolioEvents.occurredAt)],
  })

  const queued  = events.filter(e => e.eventType === 'agent_task_queued').length
  const created = events.filter(e => e.eventType === 'agent_pr_created').length
  const merged  = events.filter(e => e.eventType === 'agent_pr_merged').length
  const failed  = events.filter(e => e.eventType === 'agent_execution_failed').length
  const successRate = queued > 0 ? Math.round((merged / queued) * 100) : null

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000)
  const recentMerges = events.filter(
    e => e.eventType === 'agent_pr_merged' && e.occurredAt >= thirtyDaysAgo
  )

  // Sum actual deltas from merged events (written by webhook handler after resync)
  const totalScoreGained = recentMerges.reduce((sum, e) => {
    const meta = e.metadata as { actualDelta?: number } | null
    return sum + (meta?.actualDelta ?? 0)
  }, 0)

  return { queued, created, merged, failed, successRate, totalScoreGained, recentMergeCount: recentMerges.length }
}
