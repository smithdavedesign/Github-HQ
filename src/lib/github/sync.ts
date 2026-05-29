'use server'

import { db } from '@/lib/db'
import { repositories, repositoryMetrics, scans, users } from '@/lib/db/schema'
import type { InsertRepository, InsertRepositoryMetrics } from '@/lib/db/schema'
import { createOctokit } from './client'
import { scanRepository } from './scanner'
import { calculateHealthScore } from '@/lib/health/scoring'
import { eq, and } from 'drizzle-orm'

export async function syncAllRepos(userId: string): Promise<void> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
  })

  if (!user?.githubToken) {
    throw new Error('No GitHub token found for user')
  }

  const octokit = createOctokit(user.githubToken)

  // Create a scan record to track progress
  const [scan] = await db.insert(scans).values({
    userId,
    type: 'sync',
    status: 'running',
  }).returning()

  try {
    // Fetch all repos (public + private) with pagination
    const repos = await octokit.paginate(octokit.rest.repos.listForAuthenticatedUser, {
      visibility: 'all',
      affiliation: 'owner',
      per_page: 100,
      sort: 'updated',
    })

    await db.update(scans).set({ totalRepos: repos.length }).where(eq(scans.id, scan.id))

    for (let i = 0; i < repos.length; i++) {
      const repo = repos[i]
      try {
        await syncSingleRepo(userId, user.githubToken, repo)
      } catch {
        // Continue even if individual repo sync fails
      }
      await db.update(scans).set({ processedRepos: i + 1 }).where(eq(scans.id, scan.id))
    }

    await db.update(users).set({ lastSyncedAt: new Date() }).where(eq(users.id, userId))
    await db.update(scans).set({
      status: 'complete',
      completedAt: new Date(),
      processedRepos: repos.length,
    }).where(eq(scans.id, scan.id))
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  githubRepo: any,
): Promise<void> {
  const octokit = createOctokit(token)
  const owner = githubRepo.owner.login
  const name = githubRepo.name

  // Upsert repository record
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
    createdAt: new Date(githubRepo.created_at),
    updatedAt: new Date(githubRepo.updated_at),
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

  // Fetch activity data
  const [commitActivity, openIssues, openPRs, releases] = await Promise.allSettled([
    octokit.rest.repos.getCommitActivityStats({ owner, repo: name }),
    octokit.rest.issues.listForRepo({ owner, repo: name, state: 'open', per_page: 1 }),
    octokit.rest.pulls.list({ owner, repo: name, state: 'open', per_page: 1 }),
    octokit.rest.repos.listReleases({ owner, repo: name, per_page: 1 }),
  ])

  // Calculate commit counts from activity stats
  let weeklyCommits = 0
  let monthlyCommits = 0
  let quarterlyCommits = 0

  if (commitActivity.status === 'fulfilled' && Array.isArray(commitActivity.value.data)) {
    const weeks = commitActivity.value.data.slice(-13) // last 13 weeks
    quarterlyCommits = weeks.reduce((sum, w) => sum + (w.total ?? 0), 0)
    monthlyCommits = weeks.slice(-4).reduce((sum, w) => sum + (w.total ?? 0), 0)
    weeklyCommits = weeks[weeks.length - 1]?.total ?? 0
  }

  const issueCount = openIssues.status === 'fulfilled'
    ? parseInt(String(openIssues.value.headers['x-total-count'] ?? '0')) || 0
    : 0
  const prCount = openPRs.status === 'fulfilled'
    ? openPRs.value.data.length
    : 0
  const hasReleases = releases.status === 'fulfilled' && releases.value.data.length > 0

  const lastPush = githubRepo.pushed_at ? new Date(githubRepo.pushed_at) : null
  const activityStatus = deriveActivityStatus(monthlyCommits, quarterlyCommits, lastPush)
  const activityScore = calculateActivityScore(monthlyCommits, quarterlyCommits, prCount, hasReleases)

  // Run tech stack scanner
  const stackData = await scanRepository(octokit, owner, name, repoId)

  // Calculate initial health score (security score will be updated by security cron)
  const metrics: InsertRepositoryMetrics = {
    repoId,
    activityScore,
    securityScore: 100, // default; updated by security scan
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
    calculatedAt: new Date(),
  }

  // Health score computed after sub-scores are set
  metrics.healthScore = calculateHealthScore({
    activityScore: metrics.activityScore ?? 0,
    securityScore: metrics.securityScore ?? 100,
    documentationScore: metrics.documentationScore ?? 0,
    testingScore: metrics.testingScore ?? 0,
    dependencyScore: metrics.dependencyScore ?? 50,
    qualityScore: metrics.qualityScore ?? 70,
  })

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
        lastCommit: metrics.lastCommit,
        lastPush: metrics.lastPush,
        openIssues: metrics.openIssues,
        openPrs: metrics.openPrs,
        weeklyCommits: metrics.weeklyCommits,
        monthlyCommits: metrics.monthlyCommits,
        quarterlyCommits: metrics.quarterlyCommits,
        activityStatus: metrics.activityStatus,
        calculatedAt: metrics.calculatedAt,
      },
    })
}

function calculateActivityScore(
  monthlyCommits: number,
  quarterlyCommits: number,
  openPRs: number,
  hasReleases: boolean,
): number {
  let score = 0
  // commits last 30 days (max 40pts)
  score += Math.min(40, (monthlyCommits / 10) * 40)
  // commits last 90 days (max 30pts)
  score += Math.min(30, (quarterlyCommits / 30) * 30)
  // open PRs signal active work (max 15pts)
  score += openPRs > 0 ? Math.min(15, openPRs * 5) : 0
  // has recent releases (15pts)
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

function deriveActivityStatus(
  monthlyCommits: number,
  quarterlyCommits: number,
  lastPush: Date | null,
): string {
  if (!lastPush) return 'Abandoned'
  const daysSince = (Date.now() - lastPush.getTime()) / (1000 * 60 * 60 * 24)
  if (daysSince > 730) return 'Abandoned'
  if (daysSince > 365) return 'Dormant'
  if (monthlyCommits === 0 && quarterlyCommits < 5) return 'Low Activity'
  return 'Actively Maintained'
}

export async function getActiveScan(userId: string) {
  return db.query.scans.findFirst({
    where: and(eq(scans.userId, userId), eq(scans.status, 'running')),
    orderBy: (s, { desc }) => [desc(s.startedAt)],
  })
}
