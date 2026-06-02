import { db } from '@/lib/db'
import { portfolioEvents, repositoryMetrics, users } from '@/lib/db/schema'
import { eq, and, inArray, gte, lte } from 'drizzle-orm'

/**
 * Polls GitHub API for all open agent PRs (created but not yet merged in portfolio_events).
 * When a PR is found to be merged on GitHub, writes an `agent_pr_merged` event with
 * `healthBefore` captured from the current DB value — before the sync runs.
 *
 * Returns the number of newly detected merges.
 */
export async function checkMergedAgentPRs(userId: string): Promise<number> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { githubToken: true },
  })
  if (!user?.githubToken) return 0

  const events = await db.query.portfolioEvents.findMany({
    where: and(
      eq(portfolioEvents.userId, userId),
      inArray(portfolioEvents.eventType, ['agent_pr_created', 'agent_pr_merged']),
    ),
    columns: { id: true, eventType: true, repoId: true, metadata: true },
  })

  const mergedTaskIds = new Set<string>()
  for (const e of events) {
    if (e.eventType === 'agent_pr_merged') {
      const meta = e.metadata as { taskId?: string } | null
      if (meta?.taskId) mergedTaskIds.add(meta.taskId)
    }
  }

  const openPRs = events.filter(e => {
    if (e.eventType !== 'agent_pr_created') return false
    const meta = e.metadata as { taskId?: string; prUrl?: string } | null
    return meta?.taskId && !mergedTaskIds.has(meta.taskId) && meta?.prUrl
  })

  if (openPRs.length === 0) return 0

  const { createOctokit } = await import('@/lib/github/client')
  const octokit = createOctokit(user.githubToken)

  let detected = 0

  for (const pr of openPRs) {
    const meta = pr.metadata as { taskId?: string; prUrl?: string } | null
    if (!meta?.prUrl || !meta?.taskId) continue

    // Parse https://github.com/owner/repo/pull/123
    const match = meta.prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
    if (!match) continue
    const [, owner, repo, prNumberStr] = match
    const prNumber = parseInt(prNumberStr, 10)

    try {
      const { data: prData } = await octokit.rest.pulls.get({ owner, repo, pull_number: prNumber })

      if (!prData.merged_at) continue

      // Capture health score before the sync runs (used later to compute actualDelta)
      let healthBefore: number | null = null
      if (pr.repoId != null) {
        const metrics = await db.query.repositoryMetrics.findFirst({
          where: eq(repositoryMetrics.repoId, pr.repoId),
          columns: { healthScore: true },
        })
        if (metrics?.healthScore != null) {
          healthBefore = Math.round(Number(metrics.healthScore))
        }
      }

      await db.insert(portfolioEvents).values({
        userId,
        repoId: pr.repoId ?? null,
        eventType: 'agent_pr_merged',
        title: `Agent PR merged in ${repo}`,
        description: `Detected by 6h sync (merged ${new Date(prData.merged_at).toLocaleDateString()})`,
        metadata: {
          taskId: meta.taskId,
          prUrl: meta.prUrl,
          healthBefore,
          actualDeltaPending: healthBefore != null,
          source: 'cron-poll',
        },
      })

      detected++
    } catch (err) {
      // PR inaccessible or repo not found — skip silently, will retry next cycle
      console.warn(`[pr-merge-checker] failed to check ${owner}/${repo}#${prNumber}:`, err instanceof Error ? err.message : err)
    }
  }

  return detected
}

/**
 * After syncAllRepos has run and refreshed health scores, finds all `agent_pr_merged` events
 * with `actualDeltaPending: true` + `healthBefore` captured, computes the actual score delta,
 * and patches the event metadata.
 */
export async function resolveActualDeltas(userId: string): Promise<void> {
  const pendingEvents = await db.query.portfolioEvents.findMany({
    where: and(
      eq(portfolioEvents.userId, userId),
      eq(portfolioEvents.eventType, 'agent_pr_merged'),
    ),
    columns: { id: true, repoId: true, metadata: true },
  })

  for (const event of pendingEvents) {
    const meta = event.metadata as {
      actualDeltaPending?: boolean
      healthBefore?: number
      actualDelta?: number
    } | null

    if (!meta?.actualDeltaPending || meta.healthBefore == null || event.repoId == null) continue

    const metrics = await db.query.repositoryMetrics.findFirst({
      where: eq(repositoryMetrics.repoId, event.repoId),
      columns: { healthScore: true },
    })
    if (metrics?.healthScore == null) continue

    const healthAfter = Math.round(Number(metrics.healthScore))
    const actualDelta = healthAfter - meta.healthBefore

    // Flag low-confidence deltas: swings >20 pts likely have other contributing factors
    // (concurrent commits, unrelated security alerts, etc.)
    const deltaConfidence: 'high' | 'low' = Math.abs(actualDelta) > 20 ? 'low' : 'high'

    await db
      .update(portfolioEvents)
      .set({
        metadata: {
          ...(meta as Record<string, unknown>),
          actualDelta,
          healthAfter,
          actualDeltaPending: false,
          deltaConfidence,
        },
      })
      .where(eq(portfolioEvents.id, event.id))
  }
}
