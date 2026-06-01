'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import {
  repositories, repositoryMetrics, healthScoreHistory,
  securityFindings, portfolioEvents,
} from '@/lib/db/schema'
import { eq, and, gte, inArray, desc, ne } from 'drizzle-orm'

export interface HealthMover {
  repoId: number
  repoName: string
  delta: number
  oldScore: number
  newScore: number
}

export interface WeeklyDiff {
  topImprover: HealthMover | null
  topDecliner: HealthMover | null
  newRepos: { repoId: number; repoName: string }[]
  archivedRepos: { repoId: number; repoName: string }[]
  mrrChanges: { repoId: number; repoName: string; from: number; to: number }[]
  newCriticalAlerts: { repoId: number; repoName: string; title: string }[]
  hasData: boolean
}

export async function getWeeklyDiff(): Promise<WeeklyDiff> {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const userId = session.user.id
  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000)

  const userRepos = await db.query.repositories.findMany({
    where: eq(repositories.userId, userId),
    with: { metrics: { columns: { healthScore: true } } },
    columns: { id: true, name: true },
  })

  const repoIds = userRepos.map(r => r.id)
  if (repoIds.length === 0) {
    return { topImprover: null, topDecliner: null, newRepos: [], archivedRepos: [], mrrChanges: [], newCriticalAlerts: [], hasData: false }
  }

  const repoNameById = new Map(userRepos.map(r => [r.id, r.name]))
  const currentScoreById = new Map(userRepos.map(r => [r.id, r.metrics?.healthScore ?? 0]))

  // Fetch in parallel
  const [recentHistory, recentEvents, recentSecurity] = await Promise.all([
    // Health history from last 7 days — oldest entry per repo for delta calc
    db.query.healthScoreHistory.findMany({
      where: and(
        inArray(healthScoreHistory.repoId, repoIds),
        gte(healthScoreHistory.recordedAt, sevenDaysAgo),
      ),
      orderBy: (h, { asc }) => [asc(h.recordedDate)],
    }),

    // Portfolio events from last 7 days (exclude manual milestones)
    db.query.portfolioEvents.findMany({
      where: and(
        eq(portfolioEvents.userId, userId),
        gte(portfolioEvents.occurredAt, sevenDaysAgo),
        ne(portfolioEvents.eventType, 'manual_milestone'),
      ),
      with: { repository: { columns: { name: true } } },
      orderBy: [desc(portfolioEvents.occurredAt)],
    }),

    // New critical/high security findings from last 7 days
    db.query.securityFindings.findMany({
      where: and(
        inArray(securityFindings.repoId, repoIds),
        gte(securityFindings.createdAt, sevenDaysAgo),
        eq(securityFindings.state, 'open'),
        inArray(securityFindings.severity, ['critical', 'high']),
      ),
      columns: { repoId: true, title: true, severity: true },
    }),
  ])

  // ── Health movers ──────────────────────────────────────────────────────────
  // Group history by repo, take oldest entry as baseline
  const oldestByRepo = new Map<number, number>()
  for (const h of recentHistory) {
    if (!oldestByRepo.has(h.repoId)) {
      oldestByRepo.set(h.repoId, h.healthScore)
    }
  }

  const movers: HealthMover[] = []
  for (const [repoId, oldScore] of oldestByRepo) {
    const newScore = currentScoreById.get(repoId) ?? oldScore
    const delta = Math.round(newScore - oldScore)
    if (Math.abs(delta) >= 3) {
      movers.push({ repoId, repoName: repoNameById.get(repoId) ?? '?', delta, oldScore: Math.round(oldScore), newScore: Math.round(newScore) })
    }
  }

  const topImprover = movers.filter(m => m.delta > 0).sort((a, b) => b.delta - a.delta)[0] ?? null
  const topDecliner = movers.filter(m => m.delta < 0).sort((a, b) => a.delta - b.delta)[0] ?? null

  // ── Portfolio events ───────────────────────────────────────────────────────
  const newRepos: WeeklyDiff['newRepos'] = []
  const archivedRepos: WeeklyDiff['archivedRepos'] = []
  const mrrChanges: WeeklyDiff['mrrChanges'] = []

  for (const event of recentEvents) {
    const repoId = event.repoId
    const repoName = event.repository?.name ?? repoNameById.get(repoId ?? -1) ?? '?'
    if (!repoId) continue

    if (event.eventType === 'repo_created') {
      newRepos.push({ repoId, repoName })
    } else if (event.eventType === 'repo_archived') {
      archivedRepos.push({ repoId, repoName })
    } else if (event.eventType === 'mrr_changed' || event.eventType === 'first_revenue') {
      const meta = event.metadata as { from?: number; to?: number; mrr?: number } | null
      const from = meta?.from ?? 0
      const to = meta?.to ?? meta?.mrr ?? 0
      mrrChanges.push({ repoId, repoName, from, to })
    }
  }

  // ── Security alerts ────────────────────────────────────────────────────────
  const seenRepos = new Set<number>()
  const newCriticalAlerts: WeeklyDiff['newCriticalAlerts'] = []
  for (const f of recentSecurity) {
    if (!seenRepos.has(f.repoId)) {
      seenRepos.add(f.repoId)
      newCriticalAlerts.push({ repoId: f.repoId, repoName: repoNameById.get(f.repoId) ?? '?', title: f.title })
    }
  }

  const hasData = !!(topImprover || topDecliner || newRepos.length || archivedRepos.length || mrrChanges.length || newCriticalAlerts.length)

  return { topImprover, topDecliner, newRepos, archivedRepos, mrrChanges, newCriticalAlerts, hasData }
}
