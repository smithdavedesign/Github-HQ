import 'server-only'

import { db } from '@/lib/db'
import { factoryAllowlist } from '@/lib/agents/factory-queue'
import { nextActions, type NextActions } from './next-actions'
import { loadRepoSignals } from './repo-signals'

/** "What should I do next?" for the dashboard. */
export async function getNextActions(userId: string, now = new Date()): Promise<NextActions> {
  return nextActions(await loadRepoSignals(db, userId, now, factoryAllowlist()))
}
