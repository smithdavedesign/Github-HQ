'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import {
  repositories, repositoryMetrics, deployments,
  securityFindings, healthScoreHistory,
} from '@/lib/db/schema'
import { eq, and, lt, inArray, desc } from 'drizzle-orm'

export type FeedEventSeverity = 'critical' | 'warning' | 'info' | 'positive'

export interface FeedEvent {
  id: string
  type: 'health_drop' | 'health_improved' | 'deployment_down' | 'deployment_slow' |
        'security_critical' | 'security_high' | 'dormant' | 'no_tests' | 'build_failing' |
        'dep_cascade_risk'
  repoId: number
  repoName: string
  description: string
  detail?: string
  severity: FeedEventSeverity
  date: Date
}

export async function getPortfolioFeed(): Promise<FeedEvent[]> {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const userId = session.user.id
  const events: FeedEvent[] = []

  const userRepos = await db.query.repositories.findMany({
    where: eq(repositories.userId, userId),
    with: {
      metrics: true,
      deployments: true,
      securityFindings: { where: eq(securityFindings.state, 'open') },
    },
    columns: { id: true, name: true },
  })

  const repoIds = userRepos.map(r => r.id)
  if (repoIds.length === 0) return []

  // ── Health drops / improvements from history ──────────────────────────────
  const recentHistory = await db.query.healthScoreHistory.findMany({
    where: inArray(healthScoreHistory.repoId, repoIds),
    orderBy: [desc(healthScoreHistory.recordedAt)],
  })

  // Group by repoId, compare latest vs 7-days-ago
  const historyByRepo = new Map<number, typeof recentHistory>()
  for (const h of recentHistory) {
    if (!historyByRepo.has(h.repoId)) historyByRepo.set(h.repoId, [])
    historyByRepo.get(h.repoId)!.push(h)
  }

  for (const [repoId, history] of historyByRepo) {
    if (history.length < 2) continue
    const latest = history[0]
    const older = history[history.length - 1]
    const delta = Math.round((latest.healthScore ?? 0) - (older.healthScore ?? 0))
    const repo = userRepos.find(r => r.id === repoId)
    if (!repo) continue

    if (delta <= -5) {
      events.push({
        id: `health_drop_${repoId}`,
        type: 'health_drop',
        repoId,
        repoName: repo.name,
        description: `Health score dropped ${Math.abs(delta)} points`,
        detail: `${Math.round(older.healthScore ?? 0)} → ${Math.round(latest.healthScore ?? 0)}`,
        severity: delta <= -15 ? 'critical' : 'warning',
        date: latest.recordedAt ?? new Date(),
      })
    } else if (delta >= 5) {
      events.push({
        id: `health_improved_${repoId}`,
        type: 'health_improved',
        repoId,
        repoName: repo.name,
        description: `Health score improved ${delta} points`,
        detail: `${Math.round(older.healthScore ?? 0)} → ${Math.round(latest.healthScore ?? 0)}`,
        severity: 'positive',
        date: latest.recordedAt ?? new Date(),
      })
    }
  }

  // ── Deployment events ──────────────────────────────────────────────────────
  for (const repo of userRepos) {
    for (const dep of repo.deployments) {
      if (dep.status === 'down') {
        events.push({
          id: `dep_down_${dep.id}`,
          type: 'deployment_down',
          repoId: repo.id,
          repoName: repo.name,
          description: 'Production deployment is down',
          detail: dep.url,
          severity: 'critical',
          date: dep.lastChecked ?? new Date(),
        })
      } else if (dep.status === 'slow') {
        events.push({
          id: `dep_slow_${dep.id}`,
          type: 'deployment_slow',
          repoId: repo.id,
          repoName: repo.name,
          description: `Deployment responding slowly (${dep.responseTimeMs}ms)`,
          detail: dep.url,
          severity: 'warning',
          date: dep.lastChecked ?? new Date(),
        })
      }
    }
  }

  // ── Security findings ──────────────────────────────────────────────────────
  for (const repo of userRepos) {
    const critical = repo.securityFindings.filter(f => f.severity === 'critical')
    const high = repo.securityFindings.filter(f => f.severity === 'high')

    if (critical.length > 0) {
      events.push({
        id: `sec_critical_${repo.id}`,
        type: 'security_critical',
        repoId: repo.id,
        repoName: repo.name,
        description: `${critical.length} critical security alert${critical.length > 1 ? 's' : ''}`,
        detail: critical[0].title,
        severity: 'critical',
        date: critical[0].createdAt ?? new Date(),
      })
    } else if (high.length > 0) {
      events.push({
        id: `sec_high_${repo.id}`,
        type: 'security_high',
        repoId: repo.id,
        repoName: repo.name,
        description: `${high.length} high-severity alert${high.length > 1 ? 's' : ''}`,
        detail: high[0].title,
        severity: 'warning',
        date: high[0].createdAt ?? new Date(),
      })
    }
  }

  // ── Dormant repos ──────────────────────────────────────────────────────────
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400_000)
  for (const repo of userRepos) {
    const lastPush = repo.metrics?.lastPush
    if (lastPush && new Date(lastPush) < ninetyDaysAgo) {
      const daysAgo = Math.floor((Date.now() - new Date(lastPush).getTime()) / 86400_000)
      events.push({
        id: `dormant_${repo.id}`,
        type: 'dormant',
        repoId: repo.id,
        repoName: repo.name,
        description: `No commits for ${daysAgo} days`,
        severity: daysAgo > 365 ? 'warning' : 'info',
        date: new Date(lastPush),
      })
    }
  }

  // ── Failing builds ─────────────────────────────────────────────────────────
  for (const repo of userRepos) {
    if (repo.metrics?.buildStatus === 'failure') {
      events.push({
        id: `build_fail_${repo.id}`,
        type: 'build_failing',
        repoId: repo.id,
        repoName: repo.name,
        description: 'Latest GitHub Actions build failed',
        severity: 'warning',
        date: repo.metrics.calculatedAt ?? new Date(),
      })
    }
  }

  // ── Dependency cascade risk (Phase 29) ────────────────────────────────────
  // If a repo that other portfolio repos depend on has a health drop, warn dependents
  for (const repo of userRepos) {
    const internalDeps = repo.metrics?.internalDeps as string[] | null | undefined
    if (!internalDeps || internalDeps.length === 0) continue

    for (const depName of internalDeps) {
      const depRepo = userRepos.find(r => r.name === depName)
      if (!depRepo?.metrics) continue

      const depHealth = depRepo.metrics.healthScore ?? 100
      if (depHealth < 60) {
        events.push({
          id: `dep_cascade_${repo.id}_${depRepo.id}`,
          type: 'dep_cascade_risk',
          repoId: repo.id,
          repoName: repo.name,
          description: `Depends on ${depName} which has low health (${Math.round(depHealth)})`,
          detail: `If ${depName} breaks, ${repo.name} may be affected`,
          severity: depHealth < 40 ? 'warning' : 'info',
          date: depRepo.metrics.calculatedAt ?? new Date(),
        })
      }
    }
  }

  // Sort: critical first, then by date descending
  const severityOrder: Record<FeedEventSeverity, number> = {
    critical: 0, warning: 1, info: 2, positive: 3,
  }
  events.sort((a, b) => {
    const sev = severityOrder[a.severity] - severityOrder[b.severity]
    if (sev !== 0) return sev
    return b.date.getTime() - a.date.getTime()
  })

  return events
}
