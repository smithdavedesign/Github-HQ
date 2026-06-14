import { db } from '@/lib/db'
import { portfolioEvents, users } from '@/lib/db/schema'
import { eq, and, inArray } from 'drizzle-orm'
import { decrypt } from '@/lib/crypto-utils'
import { respectRateLimit } from '@/lib/github/sync'

const MAX_CI_FIX_ATTEMPTS = 3

type PRMeta      = { taskId?: string; prUrl?: string }
type CIFailMeta  = { taskId?: string; sha?: string; attempt?: number }
type TerminalMeta = { taskId?: string }

/**
 * Polls GitHub check-runs on open agent PRs. For each PR with a failing check:
 *
 *  - SHA dedup: skip if we already recorded a ci_failed event for this exact
 *    commit SHA — prevents re-recording the same failure on every 6h sync until
 *    a fix commit is pushed.
 *  - If < MAX_CI_FIX_ATTEMPTS prior fix attempts: records agent_ci_failed and
 *    queues a CI fix task to Nexus with contextNotes.existingBranch so the agent
 *    pushes onto the same PR branch.
 *  - If >= MAX_CI_FIX_ATTEMPTS: records agent_needs_human and fires an in-app
 *    notification.
 *
 * Runs in the 6h sync cron before checkMergedAgentPRs.
 * Returns the number of PRs with newly detected CI failures.
 */
export async function checkCIFailuresOnAgentPRs(userId: string): Promise<number> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { githubToken: true },
  })
  if (!user?.githubToken) return 0

  const events = await db.query.portfolioEvents.findMany({
    where: and(
      eq(portfolioEvents.userId, userId),
      inArray(portfolioEvents.eventType, [
        'agent_pr_created',
        'agent_pr_merged',
        'agent_execution_failed',
        'agent_ci_failed',
        'agent_needs_human',
      ]),
    ),
    columns: { id: true, eventType: true, repoId: true, metadata: true },
  })

  // Build set of taskIds that are already terminal
  const terminalTaskIds = new Set<string>()
  for (const e of events) {
    if (
      e.eventType === 'agent_pr_merged' ||
      e.eventType === 'agent_execution_failed' ||
      e.eventType === 'agent_needs_human'
    ) {
      const m = e.metadata as TerminalMeta | null
      if (m?.taskId) terminalTaskIds.add(m.taskId)
    }
  }

  // Open PRs: agent_pr_created with no terminal event AND a known repoId.
  // Skip null-repoId events — we can't attribute CI failures without a repo handle.
  const openPREvents = events.filter(e => {
    if (e.eventType !== 'agent_pr_created') return false
    if (!e.repoId) return false
    const m = e.metadata as PRMeta | null
    return m?.taskId && !terminalTaskIds.has(m.taskId) && m?.prUrl
  })
  if (openPREvents.length === 0) return 0

  const { createOctokit } = await import('@/lib/github/client')
  const octokit = createOctokit(decrypt(user.githubToken))

  let detected = 0

  for (const prEvent of openPREvents) {
    const meta = prEvent.metadata as PRMeta | null
    if (!meta?.prUrl || !meta?.taskId || !prEvent.repoId) continue

    const match = meta.prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
    if (!match) continue
    const [, owner, repo, prNumberStr] = match
    const prNumber = parseInt(prNumberStr, 10)

    try {
      await respectRateLimit(octokit)

      const { data: prData } = await octokit.rest.pulls.get({ owner, repo, pull_number: prNumber })
      if (prData.merged_at || prData.state === 'closed') continue

      const headSha    = prData.head.sha
      const branchName = prData.head.ref

      // SHA dedup: if we already recorded a ci_failed for this exact commit,
      // don't record again until a new commit is pushed (i.e., the fix landed).
      const alreadyRecordedForSha = events.some(e => {
        if (e.eventType !== 'agent_ci_failed') return false
        const m = e.metadata as CIFailMeta | null
        return m?.taskId === meta.taskId && m?.sha === headSha
      })
      if (alreadyRecordedForSha) continue

      await respectRateLimit(octokit)

      const { data: checksData } = await octokit.rest.checks.listForRef({
        owner, repo, ref: headSha, per_page: 50,
      })

      const failedChecks = checksData.check_runs.filter(
        c => c.status === 'completed' && c.conclusion === 'failure'
      )
      if (failedChecks.length === 0) continue

      // Count distinct fix attempts (distinct SHAs that failed) for this taskId
      const priorAttempts = events.filter(e => {
        if (e.eventType !== 'agent_ci_failed') return false
        const m = e.metadata as CIFailMeta | null
        return m?.taskId === meta.taskId
      }).length

      const firstFailed  = failedChecks[0]
      const checkName    = firstFailed.name
      const errorSummary = (firstFailed.output?.summary ?? `${checkName} failed`).slice(0, 500)

      if (priorAttempts >= MAX_CI_FIX_ATTEMPTS) {
        const alreadyEscalated = events.some(e => {
          if (e.eventType !== 'agent_needs_human') return false
          const m = e.metadata as TerminalMeta | null
          return m?.taskId === meta.taskId
        })
        if (alreadyEscalated) continue

        await db.insert(portfolioEvents).values({
          userId,
          repoId: prEvent.repoId,
          eventType: 'agent_needs_human',
          title: `Agent PR needs human review: ${repo}#${prNumber}`,
          description: `CI failed ${priorAttempts} times without a working fix`,
          metadata: {
            taskId:   meta.taskId,
            prUrl:    meta.prUrl,
            branchName,
            attempts: priorAttempts,
            reason:   `CI failed ${priorAttempts} times without a working fix`,
          },
        })

        const { dispatchNotification } = await import('@/lib/notifications/dispatcher')
        await dispatchNotification({
          userId,
          eventType: 'agent_failed',
          title: `Agent PR needs human review: ${repo}#${prNumber}`,
          body: `CI failed ${priorAttempts} times. Manual review required. ${meta.prUrl}`,
          repoId: prEvent.repoId,
          metadata: { prUrl: meta.prUrl, taskId: meta.taskId },
        })

        detected++
        continue
      }

      // Record the CI failure, then attempt to queue a fix.
      // Write the event first so the lifecycle shows ci_failing immediately,
      // even if Nexus is temporarily down (the next cycle will retry queueing).
      await db.insert(portfolioEvents).values({
        userId,
        repoId: prEvent.repoId,
        eventType: 'agent_ci_failed',
        title: `CI failed on agent PR: ${repo}#${prNumber}`,
        description: errorSummary,
        metadata: {
          taskId: meta.taskId,
          prUrl:  meta.prUrl,
          branchName,
          checkName,
          errorSummary,
          attempt: priorAttempts + 1,
          sha: headSha,
        },
      })

      const { queueCIFix } = await import('@/lib/actions/nexus')
      const queued = await queueCIFix(
        userId,
        prEvent.repoId,
        `${owner}/${repo}`,
        branchName,
        prNumber,
        errorSummary,
        meta.taskId,
      )

      if (!queued) {
        // Nexus is down — the ci_failed event is written and the lifecycle shows
        // ci_failing. The next sync cycle will retry queueing (SHA dedup prevents
        // double-recording). Not counted as detected since no action was taken.
        console.warn(`[ci-checker] Nexus unavailable for ${owner}/${repo}#${prNumber} — will retry next cycle`)
        continue
      }

      detected++
    } catch (err) {
      console.warn(
        `[ci-checker] failed to check ${owner}/${repo}#${prNumber}:`,
        err instanceof Error ? err.message : err,
      )
    }
  }

  return detected
}
