import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { generateDigest } from '@/lib/ai/digest'
import { generateAdvisor, getLatestAdvisor } from '@/lib/ai/advisor'
import { generateCeoReport } from '@/lib/ai/ceo-report'
import { verifyCronSecret } from '@/lib/cron-auth'
import { autoDispatchAdvisorActions, queueSkillForUser } from '@/lib/agents/factory-queue'
import { getAccuracyByImpactType } from '@/lib/actions/advisor-accuracy'
import { distillAttempts } from '@/lib/agents/attempt-distiller'
import { isNotNull, eq } from 'drizzle-orm'
import { repositories } from '@/lib/db/schema'
import { withAutomationRun } from '@/lib/monitoring/automation-runs'

// Recorded on the Agents page's automation timeline (src/lib/monitoring/automation-runs.ts).
export const GET = withAutomationRun('cron:digest', handle)

async function handle(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const allUsers = await db.query.users.findMany({
    where: isNotNull(users.githubToken),
    columns: {
      id: true,
      autoDispatchEnabled: true,
      autoDispatchEffortGate: true,
      autoDispatchMaxPerRun: true,
      autoDispatchSkipSecurity: true,
      autoDispatchAccuracyThreshold: true,
      autoRunHealthWeekly: true,
      autoRunRetroWeekly: true,
    },
  })

  let processed = 0
  const errors: string[] = []
  let totalAutoQueued = 0

  for (const user of allUsers) {
    try {
      // Generate weekly briefing, advisor, and CEO report in parallel
      await Promise.allSettled([
        generateDigest(user.id),
        generateAdvisor(user.id),
        generateCeoReport(user.id),
        // Phase 54-T4: distill the last 7 days of agent_attempt events per repo —
        // a 7-day lookback doesn't care which day this cron runs
        distillAttempts(user.id),
      ])

      // Auto-dispatch eligible advisor actions if enabled
      if (user.autoDispatchEnabled) {
        try {
          const [advisor, accuracyStats] = await Promise.all([
            getLatestAdvisor(user.id).catch(() => null),
            getAccuracyByImpactType(user.id).catch(() => []),
          ])

          if (!advisor?.actions?.length) {
            console.warn(`[digest-cron] auto-dispatch skipped for ${user.id}: no advisor content`)
          } else {
            const dispatchResult = await autoDispatchAdvisorActions(
              user.id,
              advisor,
              {
                autoDispatchEnabled:           user.autoDispatchEnabled ?? false,
                autoDispatchEffortGate:        user.autoDispatchEffortGate ?? 'quick_only',
                autoDispatchMaxPerRun:         Math.min(10, Math.max(1, user.autoDispatchMaxPerRun ?? 3)),
                autoDispatchSkipSecurity:      user.autoDispatchSkipSecurity ?? true,
                autoDispatchAccuracyThreshold: user.autoDispatchAccuracyThreshold ?? 0,
              },
              accuracyStats,
            )
            totalAutoQueued += dispatchResult.queued
            if (dispatchResult.queued > 0) {
              console.log(`[digest-cron] auto-dispatched ${dispatchResult.queued} tasks for ${user.id}`)
            }
            if (dispatchResult.errors.length > 0) {
              console.warn(`[digest-cron] auto-dispatch errors for ${user.id}:`, dispatchResult.errors)
            }
          }
        } catch (dispatchErr) {
          // Never let dispatch failures crash the digest run
          console.warn('[digest-cron] auto-dispatch failed:', dispatchErr instanceof Error ? dispatchErr.message : dispatchErr)
        }
      }

      // G7: Scheduled skill runs on focused repos
      const now = new Date()
      const isMonday = now.getDay() === 1
      const isSunday = now.getDay() === 0

      if (user.autoRunRetroWeekly && isMonday) {
        try {
          const focusedRepos = await db.query.repositories.findMany({
            where: eq(repositories.userId, user.id),
            columns: { id: true, name: true },
          }).then(r => r.filter((_, i) => i < 3)) // max 3 focused retros
          for (const repo of focusedRepos) {
            // A report request (/retro): the factory reads the week's commits, opens no PR.
            await queueSkillForUser(user.id, repo.id, 'retro', `Weekly retro for ${repo.name}: what shipped, what's risky, what's unfinished.`, 'auto-dispatch')
              .catch(() => null) // non-fatal
          }
        } catch { /* non-fatal */ }
      }

      if (user.autoRunHealthWeekly && isSunday) {
        try {
          const focusedRepos = await db.query.repositories.findMany({
            where: eq(repositories.userId, user.id),
            columns: { id: true, name: true },
          }).then(r => r.filter((_, i) => i < 5)) // max 5 health checks
          for (const repo of focusedRepos) {
            // A report request (/health): findings and a 0–10 score, no PR.
            await queueSkillForUser(user.id, repo.id, 'health', `Weekly health check for ${repo.name}.`, 'auto-dispatch')
              .catch(() => null) // non-fatal
          }
        } catch { /* non-fatal */ }
      }

      processed++
    } catch (err) {
      errors.push(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  return NextResponse.json({ ok: true, processed, errors, autoQueued: totalAutoQueued })
}
