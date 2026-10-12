import 'server-only'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { portfolioEvents } from '@/lib/db/schema'
import { eq, and, inArray } from 'drizzle-orm'
import {
  IMPACT_TYPES,
  SUPPRESS_THRESHOLDS,
  computeAccuracy,
  type AccuracyStat,
  type ImpactType,
} from './advisor-accuracy-utils'

export type AccuracyStats = AccuracyStat

/**
 * Returns accuracy stats broken down by impactType.
 * Uses only high-confidence merges (deltaConfidence !== 'low').
 * Time-decay: events in the last 30 days count 2x.
 */
export async function getAccuracyByImpactType(userId: string): Promise<AccuracyStats[]> {
  let mergedEvents: Array<{ eventType: string; metadata: unknown; occurredAt: Date }> = []
  try {
    mergedEvents = await db.query.portfolioEvents.findMany({
      where: and(
        eq(portfolioEvents.userId, userId),
        inArray(portfolioEvents.eventType, ['agent_pr_merged', 'agent_execution_failed']),
      ),
      columns: { eventType: true, metadata: true, occurredAt: true },
    })
  } catch (err) {
    console.warn('[advisor-accuracy] DB query failed:', err instanceof Error ? err.message : err)
    return []
  }

  return IMPACT_TYPES.map(t => computeAccuracy(mergedEvents, t))
}

/**
 * Returns per-repo accuracy for a specific repo.
 * Uses the hybrid model: returns repo-specific if ≥3 data points, otherwise global.
 */
/** Used internally by getMyAccuracyStats — no external callers */
async function getRepoAccuracy(
  userId: string,
  repoId: number,
): Promise<AccuracyStats[]> {
  const repoEvents = await db.query.portfolioEvents.findMany({
    where: and(
      eq(portfolioEvents.userId, userId),
      eq(portfolioEvents.repoId, repoId),
      inArray(portfolioEvents.eventType, ['agent_pr_merged', 'agent_execution_failed']),
    ),
    columns: { eventType: true, metadata: true, occurredAt: true },
  })

  // Repo-specific only where the repo has ≥ 3 events of that type; the caller falls back to global.
  return IMPACT_TYPES
    .filter(t => repoEvents.filter(e => (e.metadata as { impactType?: string } | null)?.impactType === t).length >= 3)
    .map(t => computeAccuracy(repoEvents, t))
}

/**
 * Returns repos that should be downgraded in recommendations because they have
 * repeated failures on the same impactType. Threshold is risk-adjusted per type.
 */
export async function getDowngradedRepos(userId: string): Promise<
  { repoId: number; repoName: string; impactType: ImpactType; failureCount: number }[]
> {
  const allEvents = await db.query.portfolioEvents.findMany({
    where: and(
      eq(portfolioEvents.userId, userId),
      inArray(portfolioEvents.eventType, ['agent_pr_merged', 'agent_execution_failed']),
    ),
    columns: { repoId: true, eventType: true, metadata: true },
    with: { repository: { columns: { name: true } } },
  })

  type Key = `${number}::${string}`
  const counters = new Map<Key, { total: number; failures: number; repoName: string; impactType: ImpactType }>()

  for (const e of allEvents) {
    if (!e.repoId) continue
    const m = e.metadata as { impactType?: string; actualDelta?: number; actualDeltaPending?: boolean } | null
    if (!m?.impactType) continue
    const impactType = m.impactType as ImpactType
    const key = `${e.repoId}::${impactType}` as Key
    if (!counters.has(key)) {
      counters.set(key, { total: 0, failures: 0, repoName: e.repository?.name ?? '?', impactType })
    }
    const c = counters.get(key)!
    c.total++
    const isFailed = e.eventType === 'agent_execution_failed' ||
      (e.eventType === 'agent_pr_merged' && !m?.actualDeltaPending && ((m as { actualDelta?: number }).actualDelta ?? 0) <= 0)
    if (isFailed) c.failures++
  }

  const downgraded: { repoId: number; repoName: string; impactType: ImpactType; failureCount: number }[] = []
  for (const [key, c] of counters) {
    const repoId = parseInt(key.split('::')[0])
    const threshold = SUPPRESS_THRESHOLDS[c.impactType]
    const failureRate = c.total > 0 ? c.failures / c.total : 0
    if (failureRate >= threshold.maxFailureRate && c.total >= threshold.minAttempts) {
      downgraded.push({ repoId, repoName: c.repoName, impactType: c.impactType, failureCount: c.failures })
    }
  }

  return downgraded
}

/**
 * Server action wrapper for use in server components.
 */
export async function getMyAccuracyStats(): Promise<AccuracyStats[]> {
  const session = await auth()
  if (!session?.user?.id) return []
  return getAccuracyByImpactType(session.user.id)
}

