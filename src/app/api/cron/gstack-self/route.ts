import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { users, repositories } from '@/lib/db/schema'
import { verifyCronSecret } from '@/lib/cron-auth'
import { queueGstackSelfScan } from '@/lib/actions/nexus'
import { isNotNull, eq } from 'drizzle-orm'

/**
 * Self-improvement cron: runs /health and /qa-only against the RepoHQ repo itself.
 *
 * Flow:
 *   1. Find every user with a GitHub token
 *   2. Locate the tracked repo matching GSTACK_SELF_REPO_NAME (default "RepoHQ")
 *   3. Queue /health + /qa-only scans via Nexus
 *   4. Nexus executes, posts findings back via /api/webhooks/agent-events
 *   5. Webhook parses findings → queues fix tasks → PRs → merged → repeat next cycle
 *
 * Schedule: daily at 07:00 UTC (vercel.json)
 */
export async function GET(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const selfRepoName = process.env.GSTACK_SELF_REPO_NAME ?? 'RepoHQ'

  const allUsers = await db.query.users.findMany({
    where: isNotNull(users.githubToken),
    columns: { id: true },
  })

  const results: Array<{
    userId: string
    repoFullName: string
    healthTaskId: string | null
    qaTaskId: string | null
  }> = []
  const errors: string[] = []

  for (const user of allUsers) {
    try {
      const rows = await db
        .select({ id: repositories.id, fullName: repositories.fullName })
        .from(repositories)
        .where(
          eq(repositories.userId, user.id),
        )
        .then(r => r.filter(row => row.fullName.toLowerCase().endsWith(selfRepoName.toLowerCase())))

      const repo = rows[0] ?? null

      if (!repo) {
        errors.push(`user ${user.id}: repo "${selfRepoName}" not found in tracked repos`)
        continue
      }

      const [healthTaskId, qaTaskId] = await Promise.all([
        queueGstackSelfScan(user.id, repo.id, repo.fullName, 'health'),
        queueGstackSelfScan(user.id, repo.id, repo.fullName, 'qa-only'),
      ])

      results.push({ userId: user.id, repoFullName: repo.fullName, healthTaskId, qaTaskId })
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err))
    }
  }

  return NextResponse.json({ ok: true, results, errors })
}
