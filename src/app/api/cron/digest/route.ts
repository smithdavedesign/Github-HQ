import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { generateDigest } from '@/lib/ai/digest'
import { generateAdvisor, getLatestAdvisor } from '@/lib/ai/advisor'
import { generateCeoReport } from '@/lib/ai/ceo-report'
import { verifyCronSecret } from '@/lib/cron-auth'
import { autoDispatchAdvisorActions } from '@/lib/actions/nexus'
import { getAccuracyByImpactType } from '@/lib/actions/advisor-accuracy'
import { isNotNull } from 'drizzle-orm'

export async function GET(request: Request) {
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

      processed++
    } catch (err) {
      errors.push(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  return NextResponse.json({ ok: true, processed, errors, autoQueued: totalAutoQueued })
}
