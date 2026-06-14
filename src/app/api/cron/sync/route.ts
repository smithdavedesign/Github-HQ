import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { syncAllRepos } from '@/lib/github/sync'
import { snapshotHealthScores } from '@/lib/health/history'
import { snapshotPortfolioScore } from '@/lib/health/portfolio-snapshot'
import { refreshGoalProgress } from '@/lib/actions/goals'
import { syncStripeMrr } from '@/lib/actions/stripe'
import { checkMergedAgentPRs, resolveActualDeltas } from '@/lib/agents/pr-merge-checker'
import { checkCIFailuresOnAgentPRs } from '@/lib/agents/ci-checker'
import { checkHealthThresholdAlerts } from '@/lib/notifications/dispatcher'
import { verifyCronSecret } from '@/lib/cron-auth'
import { isNotNull } from 'drizzle-orm'

export async function GET(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const allUsers = await db.query.users.findMany({
    where: isNotNull(users.githubToken),
    columns: { id: true },
  })

  let processed = 0
  let failed = 0
  for (const user of allUsers) {
    try {
      await checkCIFailuresOnAgentPRs(user.id)
      await checkMergedAgentPRs(user.id)
      await syncAllRepos(user.id)
      await Promise.allSettled([
        snapshotHealthScores(user.id),
        snapshotPortfolioScore(user.id),
        refreshGoalProgress(user.id),
        syncStripeMrr(user.id),
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
