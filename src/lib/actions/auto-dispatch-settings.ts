'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function saveAutoDispatch(settings: {
  autoDispatchEnabled: boolean
  autoDispatchEffortGate: string
  autoDispatchMaxPerRun: number
  autoDispatchSkipSecurity: boolean
  autoDispatchAccuracyThreshold: number
}): Promise<void> {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const validGates = ['quick_only', 'quick_and_medium', 'all']
  if (!validGates.includes(settings.autoDispatchEffortGate)) {
    throw new Error('Invalid effort gate')
  }

  await db.update(users).set({
    autoDispatchEnabled:           settings.autoDispatchEnabled,
    autoDispatchEffortGate:        settings.autoDispatchEffortGate,
    autoDispatchMaxPerRun:         Math.min(10, Math.max(1, settings.autoDispatchMaxPerRun)),
    autoDispatchSkipSecurity:      settings.autoDispatchSkipSecurity,
    autoDispatchAccuracyThreshold: Math.min(100, Math.max(0, settings.autoDispatchAccuracyThreshold)),
  }).where(eq(users.id, session.user.id))
}

export async function getAutoDispatchSettings() {
  const session = await auth()
  if (!session?.user?.id) return null

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: {
      autoDispatchEnabled: true,
      autoDispatchEffortGate: true,
      autoDispatchMaxPerRun: true,
      autoDispatchSkipSecurity: true,
      autoDispatchAccuracyThreshold: true,
    },
  })
  return {
    autoDispatchEnabled:           user?.autoDispatchEnabled ?? false,
    autoDispatchEffortGate:        user?.autoDispatchEffortGate ?? 'quick_only',
    autoDispatchMaxPerRun:         user?.autoDispatchMaxPerRun ?? 3,
    autoDispatchSkipSecurity:      user?.autoDispatchSkipSecurity ?? true,
    autoDispatchAccuracyThreshold: user?.autoDispatchAccuracyThreshold ?? 0,
  }
}
