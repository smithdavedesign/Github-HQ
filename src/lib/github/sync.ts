'use server'

import { db } from '@/lib/db'
import { toNum } from '@/lib/utils'
import { repositories, repositoryMetrics, scans, users, portfolioEvents, digests } from '@/lib/db/schema'
import type { InsertRepository, InsertRepositoryMetrics } from '@/lib/db/schema'
import { createOctokit } from './client'
import { scanRepository } from './scanner'
import { calculateHealthScore, calculateOpportunityScore, calculateArchiveScore } from '@/lib/health/scoring'
import { calculateValuation } from '@/lib/health/valuation'
import { computePortfolioEvents, computeInternalDeps, computeExternalDeps, shouldInvalidateCachedBrief } from '@/lib/health/events'
import type { RepoDepInfo } from '@/lib/health/events'
import { eq, and } from 'drizzle-orm'
import { decrypt } from '@/lib/crypto-utils'

type ExistingRepoState = {
  id: number
  mrr: string | null
  isArchived: boolean | null
  metrics: { healthScore: number | null } | null
} | null | undefined

// Minimal typed shape covering all fields accessed by syncSingleRepo.
// Compatible with the listForAuthenticatedUser response as well as the hand-crafted
// stubs passed by the on-demand sync paths.
interface GithubRepoInput {
  id: number
  name: string
  full_name: string
  owner: { login: string }
  visibility?: string | null
  private?: boolean
  description?: string | null
  default_branch?: string | null
  homepage?: string | null
  stargazers_count?: number | null
  forks_count?: number | null
  language?: string | null
  archived?: boolean | null
  fork?: boolean | null
  pushed_at?: string | null
  created_at: string | null
  updated_at: string | null
}

// Pause between repos if GitHub rate limit is getting low
export async function respectRateLimit(octokit: Awaited<ReturnType<typeof createOctokit>>) {
  try {
    const { data } = await octokit.rest.rateLimit.get()
    const remaining = data.rate.remaining
    if (remaining < 100) {
      const resetMs = data.rate.reset * 1000 - Date.now()
      const waitMs = Math.min(resetMs + 1000, 60_000)
      console.warn(`[sync] rate limit low (${remaining} remaining), waiting ${Math.round(waitMs / 1000)}s`)
      await new Promise(r => setTimeout(r, waitMs))
    } else if (remaining < 300) {
      // Slow down gently
      await new Promise(r => setTimeout(r, 500))
    }
  } catch {
    // Non-fatal — continue
  }
}

export async function syncAllRepos(userId: string): Promise<void> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) })
  if (!user?.githubToken) throw new Error('No GitHub token found for user')

  const octokit = createOctokit(decrypt(user.githubToken))

  const [scan] = await db.insert(scans).values({ userId, type: 'sync', status: 'running' }).returning()

  try {
    const repos = await octokit.paginate(octokit.rest.repos.listForAuthenticatedUser, {
      visibility: 'all',
      affiliation: 'owner',
      per_page: 100,
      sort: 'updated',
    })

    await db.update(scans).set({ totalRepos: repos.length }).where(eq(scans.id, scan.id))

    // Batch pre-fetch all existing repo states — 1 query instead of N
    const existingRepos = await db.query.repositories.findMany({
      where: eq(repositories.userId, userId),
      with: { metrics: { columns: { healthScore: true } } },
      columns: { id: true, githubId: true, mrr: true, isArchived: true },
    })
    const existingByGithubId = new Map(existingRepos.map(r => [r.githubId, r]))

    let processed = 0
    const depInfos: RepoDepInfo[] = []
    for (const repo of repos) {
      try {
        await respectRateLimit(octokit)
        const depInfo = await syncSingleRepo(
          userId, decrypt(user.githubToken), repo,
          existingByGithubId.get(repo.id) ?? null,
        )
        if (depInfo) depInfos.push(depInfo)
        processed++
        await db.update(scans).set({ processedRepos: processed }).where(eq(scans.id, scan.id))
      } catch (err) {
        console.error(`[sync] failed ${repo.full_name}:`, err instanceof Error ? err.message : err)
      }
    }

    // Phase 29: cross-reference internal deps using pure function
    if (depInfos.length > 1) {
      await resolveInternalDeps(depInfos)
    }

    // Phase 33: tag prominent shared external deps for the dependency graph
    if (depInfos.length > 0) {
      await resolveExternalDeps(depInfos)
    }

    await db.update(users).set({ lastSyncedAt: new Date() }).where(eq(users.id, userId))
    await db.update(scans).set({ status: 'complete', completedAt: new Date() }).where(eq(scans.id, scan.id))
    // Invalidate advisor repo snapshot so next advisor generation recomputes deltas with fresh metrics
    await db.update(digests)
      .set({ advisorRepoSnapshot: null })
      .where(eq(digests.userId, userId))
  } catch (error) {
    await db.update(scans).set({
      status: 'failed',
      completedAt: new Date(),
      error: error instanceof Error ? error.message : 'Unknown error',
    }).where(eq(scans.id, scan.id))
    throw error
  }
}

export async function syncSingleRepo(
  userId: string,
  token: string,
  githubRepo: GithubRepoInput,
  existingState: ExistingRepoState = undefined,
): Promise<RepoDepInfo | null> {
  const octokit = createOctokit(token)
  const owner = githubRepo.owner.login
  const name = githubRepo.name

  // When called standalone (not from syncAllRepos), fetch existing state individually
  const existingRepo = existingState !== undefined
    ? existingState
    : await db.query.repositories.findFirst({
        where: and(eq(repositories.githubId, githubRepo.id), eq(repositories.userId, userId)),
        with: { metrics: { columns: { healthScore: true } } },
        columns: { id: true, mrr: true, isArchived: true },
      })
  const isNew = !existingRepo

  const repoData: InsertRepository = {
    userId,
    githubId: githubRepo.id,
    name: githubRepo.name,
    owner,
    fullName: githubRepo.full_name,
    visibility: githubRepo.visibility ?? (githubRepo.private ? 'private' : 'public'),
    description: githubRepo.description,
    defaultBranch: githubRepo.default_branch ?? 'main',
    homepage: githubRepo.homepage,
    stars: githubRepo.stargazers_count ?? 0,
    forks: githubRepo.forks_count ?? 0,
    language: githubRepo.language,
    isArchived: githubRepo.archived ?? false,
    isFork: githubRepo.fork ?? false,
    createdAt: githubRepo.created_at ? new Date(githubRepo.created_at) : new Date(),
    updatedAt: githubRepo.updated_at ? new Date(githubRepo.updated_at) : new Date(),
    syncedAt: new Date(),
  }

  const [upsertedRepo] = await db
    .insert(repositories)
    .values(repoData)
    .onConflictDoUpdate({
      target: [repositories.githubId],
      set: {
        name: repoData.name,
        owner: repoData.owner,
        fullName: repoData.fullName,
        visibility: repoData.visibility,
        description: repoData.description,
        homepage: repoData.homepage,
        stars: repoData.stars,
        forks: repoData.forks,
        language: repoData.language,
        isArchived: repoData.isArchived,
        updatedAt: repoData.updatedAt,
        syncedAt: repoData.syncedAt,
      },
    })
    .returning()

  const repoId = upsertedRepo.id

  // Fetch all data in parallel
  const [commitActivity, openIssues, openPRs, releases, workflowRuns] = await Promise.allSettled([
    octokit.rest.repos.getCommitActivityStats({ owner, repo: name }),
    octokit.rest.issues.listForRepo({ owner, repo: name, state: 'open', per_page: 1 }),
    octokit.rest.pulls.list({ owner, repo: name, state: 'open', per_page: 1 }),
    octokit.rest.repos.listReleases({ owner, repo: name, per_page: 1 }),
    octokit.rest.actions.listWorkflowRunsForRepo({ owner, repo: name, per_page: 1 }),
  ])

  // Process commit data
  let weeklyCommits = 0
  let monthlyCommits = 0
  let quarterlyCommits = 0
  let weeklyCommitData: { week: number; total: number }[] = []

  if (commitActivity.status === 'fulfilled' && Array.isArray(commitActivity.value.data)) {
    const weeks = commitActivity.value.data.slice(-13)
    weeklyCommitData = weeks.map(w => ({ week: w.week ?? 0, total: w.total ?? 0 }))
    quarterlyCommits = weeks.reduce((sum, w) => sum + (w.total ?? 0), 0)
    monthlyCommits = weeks.slice(-4).reduce((sum, w) => sum + (w.total ?? 0), 0)
    weeklyCommits = weeks[weeks.length - 1]?.total ?? 0
  }

  const issueCount = openIssues.status === 'fulfilled'
    ? parseInt(String(openIssues.value.headers['x-total-count'] ?? '0')) || 0
    : 0
  const prCount = openPRs.status === 'fulfilled' ? openPRs.value.data.length : 0
  const hasReleases = releases.status === 'fulfilled' && releases.value.data.length > 0

  // Build status from latest workflow run
  let buildStatus: string | null = null
  if (workflowRuns.status === 'fulfilled' && workflowRuns.value.data.workflow_runs.length > 0) {
    const run = workflowRuns.value.data.workflow_runs[0]
    buildStatus = run.conclusion ?? run.status ?? null
  }

  const lastPush = githubRepo.pushed_at ? new Date(githubRepo.pushed_at) : null
  const activityStatus = deriveActivityStatus(monthlyCommits, quarterlyCommits, lastPush)
  const activityScore = calculateActivityScore(monthlyCommits, quarterlyCommits, prCount, hasReleases)

  const stackData = await scanRepository(octokit, owner, name, repoId)

  // Fetch existing security score (set by the security cron) before calculating health.
  // If we use the hardcoded 100 here, health scores ignore real Dependabot alerts.
  const [repoRecord, existingMetrics] = await Promise.all([
    db.query.repositories.findFirst({
      where: eq(repositories.id, repoId),
      with: { deployments: { columns: { status: true } } },
      columns: { mrr: true, stars: true, isRevenueGenerating: true },
    }),
    db.query.repositoryMetrics.findFirst({
      where: eq(repositoryMetrics.repoId, repoId),
      columns: { securityScore: true },
    }),
  ])

  const currentSecurityScore = existingMetrics?.securityScore ?? 100

  const metrics: InsertRepositoryMetrics = {
    repoId,
    activityScore,
    securityScore: 100,   // preserved from security cron via onConflictDoUpdate (not in set)
    documentationScore: stackData.documentationScore,
    testingScore: stackData.testingScore,
    dependencyScore: calculateDependencyScore(lastPush),
    qualityScore: 70,
    lastCommit: lastPush,
    lastPush,
    openIssues: issueCount,
    openPrs: prCount,
    weeklyCommits,
    monthlyCommits,
    quarterlyCommits,
    activityStatus,
    buildStatus,
    weeklyCommitData: weeklyCommitData.length > 0 ? weeklyCommitData : null,
    calculatedAt: new Date(),
  }

  const hasLiveDeployment = repoRecord?.deployments.some(d => d.status === 'healthy' || d.status === 'slow') ?? false
  const deploymentScore = calculateDeploymentScore(repoRecord?.deployments ?? [])

  // Repos in stable/completed lifecycles or passive purposes aren't expected
  // to have frequent commits — floor activity at 40 so they aren't penalised.
  const STABLE_LIFECYCLES = new Set(['maintaining', 'sunsetting', 'archived'])
  const STABLE_PURPOSES   = new Set(['Reference', 'Client Work', 'Consulting', 'Infrastructure'])
  const isStableRepo =
    STABLE_LIFECYCLES.has(upsertedRepo.lifecycleStatus ?? '') ||
    STABLE_PURPOSES.has(upsertedRepo.purpose ?? '')
  const effectiveActivity = isStableRepo
    ? Math.max(metrics.activityScore ?? 0, 40)
    : (metrics.activityScore ?? 0)

  metrics.healthScore = calculateHealthScore({
    activityScore: effectiveActivity,
    securityScore: currentSecurityScore,
    documentationScore: metrics.documentationScore ?? 0,
    testingScore: metrics.testingScore ?? 0,
    dependencyScore: metrics.dependencyScore ?? 50,
    qualityScore: metrics.qualityScore ?? 70,
    deploymentScore,
  })
  const mrrNum = toNum(repoRecord?.mrr)
  const stars = githubRepo.stargazers_count ?? 0

  metrics.opportunityScore = calculateOpportunityScore({
    healthScore: metrics.healthScore ?? 0,
    activityScore: metrics.activityScore ?? 0,
    stars,
    mrr: mrrNum,
    isRevenueGenerating: repoRecord?.isRevenueGenerating ?? false,
    hasLiveDeployment,
  })

  // Phase 22: Archive score
  const daysSinceLastPush = lastPush
    ? (Date.now() - lastPush.getTime()) / (1000 * 60 * 60 * 24)
    : 9999
  metrics.archiveScore = calculateArchiveScore({
    quarterlyCommits,
    mrr: mrrNum,
    hasLiveDeployment,
    healthScore: metrics.healthScore ?? 0,
    opportunityScore: metrics.opportunityScore ?? 0,
    daysSinceLastPush,
    isArchived: githubRepo.archived ?? false,
  })

  // Phase 15: Valuation
  const valuation = calculateValuation({
    mrr: mrrNum,
    stars,
    healthScore: metrics.healthScore ?? 0,
    activityScore: metrics.activityScore ?? 0,
    hasLiveDeployment,
    isArchived: githubRepo.archived ?? false,
    isRevenueGenerating: repoRecord?.isRevenueGenerating ?? false,
  })
  metrics.estimatedValue = valuation.estimatedValue
  metrics.valuationConfidence = valuation.valuationConfidence
  metrics.valuationMethod = valuation.valuationMethod

  await db
    .insert(repositoryMetrics)
    .values(metrics)
    .onConflictDoUpdate({
      target: [repositoryMetrics.repoId],
      set: {
        activityScore: metrics.activityScore,
        documentationScore: metrics.documentationScore,
        testingScore: metrics.testingScore,
        dependencyScore: metrics.dependencyScore,
        qualityScore: metrics.qualityScore,
        healthScore: metrics.healthScore,
        opportunityScore: metrics.opportunityScore,
        estimatedValue: metrics.estimatedValue,
        valuationConfidence: metrics.valuationConfidence,
        valuationMethod: metrics.valuationMethod,
        lastCommit: metrics.lastCommit,
        lastPush: metrics.lastPush,
        openIssues: metrics.openIssues,
        openPrs: metrics.openPrs,
        weeklyCommits: metrics.weeklyCommits,
        monthlyCommits: metrics.monthlyCommits,
        quarterlyCommits: metrics.quarterlyCommits,
        activityStatus: metrics.activityStatus,
        buildStatus: metrics.buildStatus,
        weeklyCommitData: metrics.weeklyCommitData,
        archiveScore: metrics.archiveScore,
        calculatedAt: metrics.calculatedAt,
      },
    })

  // Phase 28: capture portfolio events using pure function + onConflictDoNothing for dedup
  const eventsToInsert = computePortfolioEvents(
    repoId,
    githubRepo.name,
    githubRepo.description ?? null,
    githubRepo.archived ?? false,
    {
      isNew,
      existingMrr: toNum(existingRepo?.mrr),
      newMrr: mrrNum,
      existingIsArchived: existingRepo?.isArchived ?? false,
      oldHealthScore: existingRepo?.metrics?.healthScore ?? 0,
      newHealthScore: metrics.healthScore ?? 0,
    },
  )

  if (eventsToInsert.length > 0) {
    await db.insert(portfolioEvents)
      .values(eventsToInsert.map(e => ({ userId, repoId, ...e })))
      .onConflictDoNothing()
  }

  // Phase 54 T3: only invalidate the cached brief on high-signal events — otherwise
  // the cache survives routine syncs and get_coding_brief avoids a ~25K-token regen.
  if (shouldInvalidateCachedBrief(eventsToInsert)) {
    await db.update(repositories)
      .set({ cachedBrief: null })
      .where(eq(repositories.id, repoId))
  }

  return { repoId, repoName: githubRepo.name, packageName: stackData.packageName, depNames: stackData.allDepNames }
}

async function resolveInternalDeps(depInfos: RepoDepInfo[]) {
  const depsMap = computeInternalDeps(depInfos)
  if (depsMap.size === 0) return
  await Promise.all(
    Array.from(depsMap.entries()).map(([repoId, internalDeps]) =>
      db
        .update(repositoryMetrics)
        .set({ internalDeps: internalDeps.length > 0 ? internalDeps : null })
        .where(eq(repositoryMetrics.repoId, repoId))
    )
  )
}

async function resolveExternalDeps(depInfos: RepoDepInfo[]) {
  const depsMap = computeExternalDeps(depInfos)
  if (depsMap.size === 0) return
  await Promise.all(
    Array.from(depsMap.entries()).map(([repoId, externalDeps]) =>
      db
        .update(repositoryMetrics)
        .set({ externalDeps: externalDeps.length > 0 ? externalDeps : null })
        .where(eq(repositoryMetrics.repoId, repoId))
    )
  )
}

function calculateDeploymentScore(deployments: { status: string | null }[]): number {
  if (deployments.length === 0) return 50  // no deployments configured — neutral, not penalised
  if (deployments.some(d => d.status === 'healthy')) return 100
  if (deployments.some(d => d.status === 'slow')) return 65
  if (deployments.every(d => d.status === 'down')) return 0
  return 50  // all unknown
}

function calculateActivityScore(monthlyCommits: number, quarterlyCommits: number, openPRs: number, hasReleases: boolean): number {
  let score = 0
  score += Math.min(40, (monthlyCommits / 10) * 40)
  score += Math.min(30, (quarterlyCommits / 30) * 30)
  score += openPRs > 0 ? Math.min(15, openPRs * 5) : 0
  score += hasReleases ? 15 : 0
  return Math.round(Math.min(100, score))
}

function calculateDependencyScore(lastPush: Date | null): number {
  if (!lastPush) return 20
  const daysSince = (Date.now() - lastPush.getTime()) / (1000 * 60 * 60 * 24)
  if (daysSince < 180) return 100
  if (daysSince < 365) return 60
  return 20
}

function deriveActivityStatus(monthlyCommits: number, quarterlyCommits: number, lastPush: Date | null): string {
  if (!lastPush) return 'Abandoned'
  const daysSince = (Date.now() - lastPush.getTime()) / (1000 * 60 * 60 * 24)
  if (daysSince > 730) return 'Abandoned'
  if (daysSince > 365) return 'Dormant'
  if (monthlyCommits === 0 && quarterlyCommits < 5) return 'Low Activity'
  return 'Actively Maintained'
}

