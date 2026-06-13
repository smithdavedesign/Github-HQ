import { db } from '@/lib/db'
import { portfolioEvents, users } from '@/lib/db/schema'
import { eq, and, inArray } from 'drizzle-orm'
import { decrypt } from '@/lib/crypto-utils'

const MAX_CI_FIX_ATTEMPTS = 3

type PRMeta      = { taskId?: string; prUrl?: string; branchName?: string }
type CIFailMeta  = { taskId?: string; attempt?: number }
type TerminalMeta = { taskId?: string }

/**
 * Polls GitHub check-runs on open agent PRs. For each PR with a failing CI check:
 *  - If < 3 prior fix attempts: records agent_ci_failed + queues a CI fix task to Nexus
 *    with contextNotes.existingBranch so the agent pushes onto the same PR branch.
 *  - If >= 3 prior attempts: records agent_needs_human + dispatches an in-app notification.
 *
 * Runs in the 6h sync cron before checkMergedAgentPRs so the CI failure is recorded
 * before a potential concurrent merge closes the PR.
 *
 * Returns the number of PRs with detected CI failures.
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

  // Build set of taskIds that are already terminal (merged / failed / escalated)
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

  // Open PRs: agent_pr_created with no terminal event for the same taskId
  const openPREvents = events.filter(e => {
    if (e.eventType !== 'agent_pr_created') return false
    const m = e.metadata as PRMeta | null
    return m?.taskId && !terminalTaskIds.has(m.taskId) && m?.prUrl
  })
  if (openPREvents.length === 0) return 0

  const { createOctokit } = await import('@/lib/github/client')
  const octokit = createOctokit(decrypt(user.githubToken))

  let detected = 0

  for (const prEvent of openPREvents) {
    const meta = prEvent.metadata as PRMeta | null
    if (!meta?.prUrl || !meta?.taskId) continue

    const match = meta.prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
    if (!match) continue
    const [, owner, repo, prNumberStr] = match
    const prNumber = parseInt(prNumberStr, 10)

    try {
      const { data: prData } = await octokit.rest.pulls.get({ owner, repo, pull_number: prNumber })

      // Skip merged or closed PRs — handled by the merge checker
      if (prData.merged_at || prData.state === 'closed') continue

      const headSha    = prData.head.sha
      const branchName = prData.head.ref

      // Check-runs for the head commit
      const { data: checksData } = await octokit.rest.checks.listForRef({
        owner, repo, ref: headSha, per_page: 50,
      })

      const failedChecks = checksData.check_runs.filter(
        c => c.status === 'completed' && c.conclusion === 'failure'
      )
      if (failedChecks.length === 0) continue

      // Count prior CI fix attempts for this taskId
      const priorAttempts = events.filter(e => {
        if (e.eventType !== 'agent_ci_failed') return false
        const m = e.metadata as CIFailMeta | null
        return m?.taskId === meta.taskId
      }).length

      const firstFailed  = failedChecks[0]
      const checkName    = firstFailed.name
      const errorSummary = (firstFailed.output?.summary ?? `${checkName} failed`).slice(0, 500)

      if (priorAttempts >= MAX_CI_FIX_ATTEMPTS) {
        // Already tried enough — escalate and notify once
        const alreadyEscalated = events.some(e => {
          if (e.eventType !== 'agent_needs_human') return false
          const m = e.metadata as TerminalMeta | null
          return m?.taskId === meta.taskId
        })
        if (alreadyEscalated) continue

        await db.insert(portfolioEvents).values({
          userId,
          repoId: prEvent.repoId ?? null,
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
          repoId: prEvent.repoId ?? null,
          metadata: { prUrl: meta.prUrl, taskId: meta.taskId },
        })

        detected++
        continue
      }

      // Record the CI failure
      await db.insert(portfolioEvents).values({
        userId,
        repoId: prEvent.repoId ?? null,
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

      // Queue a CI fix task that resumes on the existing branch
      const { queueCIFix } = await import('@/lib/actions/nexus')
      await queueCIFix(
        userId,
        prEvent.repoId ?? 0,
        `${owner}/${repo}`,
        branchName,
        prNumber,
        errorSummary,
        meta.taskId,
      )

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
