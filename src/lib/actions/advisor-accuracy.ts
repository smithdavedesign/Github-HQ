'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { portfolioEvents } from '@/lib/db/schema'
import { eq, and, inArray } from 'drizzle-orm'
import {
  MIN_DATA_POINTS,
  SUPPRESS_THRESHOLDS,
  type ImpactType,
} from './advisor-accuracy-utils'

export interface AccuracyStats {
  impactType: ImpactType
  successRate: number        // 0-100 (directional: actualDelta > 0)
  dataPoints: number         // high-confidence merges with this impactType
  avgActualDelta: number     // average health pts gained on successful merges
  hasSignal: boolean         // enough data to trust this number
  timeDecayedRate: number    // last-30d weighted 2x (0-100)
}

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

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000)
  const impactTypes: ImpactType[] = ['opportunity', 'revenue', 'security', 'health']
  const stats: AccuracyStats[] = []

  for (const impactType of impactTypes) {
    const relevant = mergedEvents.filter(e => {
      const m = e.metadata as { impactType?: string; deltaConfidence?: string } | null
      return m?.impactType === impactType
    })

    if (relevant.length === 0) {
      stats.push({ impactType, successRate: 0, dataPoints: 0, avgActualDelta: 0, hasSignal: false, timeDecayedRate: 0 })
      continue
    }

    // Split merged (has outcome) vs failed
    const merges = relevant.filter(e => e.eventType === 'agent_pr_merged')
    const failures = relevant.filter(e => e.eventType === 'agent_execution_failed')

    // Only include high-confidence merges in the rate
    const highConfMerges = merges.filter(e => {
      const m = e.metadata as { deltaConfidence?: string; actualDelta?: number; actualDeltaPending?: boolean } | null
      return m?.deltaConfidence !== 'low' && !m?.actualDeltaPending && m?.actualDelta != null
    })

    const dataPoints = highConfMerges.length + failures.length

    // Successes: actualDelta > 0 (directional)
    const successes = highConfMerges.filter(e => {
      const m = e.metadata as { actualDelta?: number } | null
      return (m?.actualDelta ?? 0) > 0
    })

    const successRate = dataPoints > 0
      ? Math.round(((successes.length) / dataPoints) * 100)
      : 0

    const avgActualDelta = highConfMerges.length > 0
      ? Math.round(highConfMerges.reduce((sum, e) => {
          const m = e.metadata as { actualDelta?: number } | null
          return sum + (m?.actualDelta ?? 0)
        }, 0) / highConfMerges.length)
      : 0

    // Time-decayed rate: last 30d events count 2x
    const recentSuccesses = successes.filter(e => e.occurredAt >= thirtyDaysAgo).length
    const recentTotal = relevant.filter(e => e.occurredAt >= thirtyDaysAgo).length
    const olderSuccesses = successes.length - recentSuccesses
    const olderTotal = dataPoints - recentTotal
    const weightedSuccesses = recentSuccesses * 2 + olderSuccesses
    const weightedTotal = recentTotal * 2 + olderTotal
    const timeDecayedRate = weightedTotal > 0
      ? Math.round((weightedSuccesses / weightedTotal) * 100)
      : 0

    stats.push({
      impactType,
      successRate,
      dataPoints,
      avgActualDelta,
      hasSignal: dataPoints >= MIN_DATA_POINTS[impactType],
      timeDecayedRate,
    })
  }

  return stats
}

/**
 * Returns per-repo accuracy for a specific repo.
 * Uses the hybrid model: returns repo-specific if ≥3 data points, otherwise global.
 */
export async function getRepoAccuracy(
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

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000)
  const impactTypes: ImpactType[] = ['opportunity', 'revenue', 'security', 'health']
  const stats: AccuracyStats[] = []

  for (const impactType of impactTypes) {
    const relevant = repoEvents.filter(e => {
      const m = e.metadata as { impactType?: string } | null
      return m?.impactType === impactType
    })
    if (relevant.length < 3) continue  // not enough repo-specific data

    const merges = relevant.filter(e => e.eventType === 'agent_pr_merged')
    const failures = relevant.filter(e => e.eventType === 'agent_execution_failed')
    const highConfMerges = merges.filter(e => {
      const m = e.metadata as { deltaConfidence?: string; actualDelta?: number; actualDeltaPending?: boolean } | null
      return m?.deltaConfidence !== 'low' && !m?.actualDeltaPending && m?.actualDelta != null
    })
    const dataPoints = highConfMerges.length + failures.length
    const successes = highConfMerges.filter(e => ((e.metadata as { actualDelta?: number } | null)?.actualDelta ?? 0) > 0)
    const recentEvents = relevant.filter(e => e.occurredAt >= thirtyDaysAgo)
    const recentSuccesses = successes.filter(e => e.occurredAt >= thirtyDaysAgo).length
    const olderSuccesses = successes.length - recentSuccesses
    const weightedSuccesses = recentSuccesses * 2 + olderSuccesses
    const weightedTotal = recentEvents.length * 2 + (dataPoints - recentEvents.length)

    stats.push({
      impactType,
      successRate: dataPoints > 0 ? Math.round((successes.length / dataPoints) * 100) : 0,
      dataPoints,
      avgActualDelta: highConfMerges.length > 0
        ? Math.round(highConfMerges.reduce((s, e) => s + ((e.metadata as { actualDelta?: number } | null)?.actualDelta ?? 0), 0) / highConfMerges.length)
        : 0,
      hasSignal: dataPoints >= MIN_DATA_POINTS[impactType],
      timeDecayedRate: weightedTotal > 0 ? Math.round((weightedSuccesses / weightedTotal) * 100) : 0,
    })
  }

  return stats
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

export async function getMyDowngradedRepos() {
  const session = await auth()
  if (!session?.user?.id) return []
  return getDowngradedRepos(session.user.id)
}
