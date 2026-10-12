import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { syncAllRepos } from '@/lib/github/sync'
import { syncSecurityForUser } from '@/lib/github/security'
import { decrypt } from '@/lib/crypto-utils'
import { snapshotHealthScores } from '@/lib/health/history'
import { snapshotPortfolioScore } from '@/lib/health/portfolio-snapshot'
import { refreshGoalProgress } from '@/lib/goals-progress'
import { syncStripeMrrForUser } from '@/lib/stripe/mrr'
import { checkMergedAgentPRs, resolveActualDeltas } from '@/lib/agents/pr-merge-checker'
import { checkCIFailuresOnAgentPRs } from '@/lib/agents/ci-checker'
import { checkHealthThresholdAlerts } from '@/lib/notifications/dispatcher'
import { verifyCronSecret } from '@/lib/cron-auth'
import { withAutomationRun } from '@/lib/monitoring/automation-runs'
import { isNotNull } from 'drizzle-orm'

// Recorded on the Agents page's automation timeline (src/lib/monitoring/automation-runs.ts).
export const GET = withAutomationRun('cron:sync', handle)

async function handle(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const allUsers = await db.query.users.findMany({
    where: isNotNull(users.githubToken),
    columns: { id: true, githubToken: true },
  })

  let processed = 0
  let failed = 0
  for (const user of allUsers) {
    try {
      await checkCIFailuresOnAgentPRs(user.id)
      await checkMergedAgentPRs(user.id)
      await syncAllRepos(user.id)
      // Alerts every 6 hours, not only at the daily security scan: Open-Travel showed 20 open all day
      // after #68 fixed them three minutes past the scan, and the morning report recommended patching them.
      if (user.githubToken) {
        await syncSecurityForUser(user.id, decrypt(user.githubToken)).catch(err =>
          console.error('[cron/sync] security refresh failed', { userId: user.id, error: err instanceof Error ? err.message : String(err) }))
      }
      await Promise.allSettled([
        snapshotHealthScores(user.id),
        snapshotPortfolioScore(user.id),
        refreshGoalProgress(user.id),
        syncStripeMrrForUser(user.id),
        resolveActualDeltas(user.id),
        checkHealthThresholdAlerts(user.id),
      ])
      processed++
    } catch (err) {
      failed++
      console.error('[cron/sync] user sync failed', {
        userId: user.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return NextResponse.json({ ok: true, processed, failed, total: allUsers.length })
}
