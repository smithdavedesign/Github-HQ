import { db } from '@/lib/db'
import { securityFindings, repositoryMetrics, repositories } from '@/lib/db/schema'
import type { InsertSecurityFinding } from '@/lib/db/schema'
import type { OctokitClient } from './client'
import { eq, and, inArray } from 'drizzle-orm'
import { calculateHealthScore, securityScoreFromAlerts, type AlertCounts } from '@/lib/health/scoring'

export async function syncSecurityForUser(userId: string, token: string): Promise<void> {
  const octokit: OctokitClient = new (await import('@octokit/rest')).Octokit({ auth: token })

  const userRepos = await db.query.repositories.findMany({
    where: eq(repositories.userId, userId),
    with: { metrics: true },
  })

  for (const repo of userRepos) {
    await syncRepoSecurity(octokit, repo.owner, repo.name, repo.id)
  }
}

async function syncRepoSecurity(
  octokit: OctokitClient,
  owner: string,
  name: string,
  repoId: number,
): Promise<void> {
  const [dependabotAlerts, secretAlerts] = await Promise.allSettled([
    octokit.paginate(octokit.rest.dependabot.listAlertsForRepo, {
      owner,
      repo: name,
      state: 'open',
      per_page: 100,
    }),
    octokit.paginate(octokit.rest.secretScanning.listAlertsForRepo, {
      owner,
      repo: name,
      state: 'open',
      per_page: 100,
    }),
  ])

  // Replace a type of finding only when it was read: a failed or forbidden read (Dependabot
  // alerts off, a GitHub error) keeps what's stored instead of wiping it.
  const readTypes = [
    ...(dependabotAlerts.status === 'fulfilled' ? ['dependabot'] : []),
    ...(secretAlerts.status === 'fulfilled' ? ['secret'] : []),
  ]
  if (readTypes.length > 0) {
    await db.delete(securityFindings).where(
      and(eq(securityFindings.repoId, repoId), eq(securityFindings.state, 'open'), inArray(securityFindings.type, readTypes))
    )
  }

  const counts: AlertCounts = { critical: 0, high: 0, medium: 0, low: 0, secrets: 0 }
  const rows: InsertSecurityFinding[] = []

  if (dependabotAlerts.status === 'fulfilled') {
    for (const alert of dependabotAlerts.value) {
      const severity = (alert.security_advisory?.severity ?? 'medium').toLowerCase()
      if (severity === 'critical' || severity === 'high' || severity === 'medium' || severity === 'low') counts[severity]++
      else counts.low++
      rows.push({
        repoId,
        githubAlertId: alert.number,
        type: 'dependabot',
        severity,
        title: alert.security_advisory?.summary ?? alert.dependency?.package?.name ?? 'Dependency alert',
        description: alert.security_advisory?.description ?? undefined,
        packageName: alert.dependency?.package?.name ?? undefined,
        state: 'open',
        createdAt: new Date(alert.created_at),
      })
    }
  }

  if (secretAlerts.status === 'fulfilled') {
    for (const alert of secretAlerts.value) {
      counts.secrets++
      rows.push({
        repoId,
        githubAlertId: alert.number,
        type: 'secret',
        severity: 'high',
        title: `Secret detected: ${alert.secret_type_display_name ?? alert.secret_type ?? 'Unknown'}`,
        state: 'open',
        createdAt: new Date(alert.created_at ?? Date.now()),
      })
    }
  }

  if (rows.length > 0) {
    await db.insert(securityFindings).values(rows)
  }

  // Unknown (null) unless Dependabot alerts were read: "couldn't check" must not look like 100.
  // An open secret alert is a known problem even without Dependabot, so it still scores.
  const securityScore = dependabotAlerts.status === 'fulfilled' || counts.secrets > 0 ? securityScoreFromAlerts(counts) : null

  // Update security score and recalculate health score
  const existing = await db.query.repositoryMetrics.findFirst({
    where: eq(repositoryMetrics.repoId, repoId),
  })

  if (existing) {
    const updated = { ...existing, securityScore }
    const healthScore = calculateHealthScore(updated)
    await db
      .update(repositoryMetrics)
      .set({ securityScore, healthScore, calculatedAt: new Date() })
      .where(eq(repositoryMetrics.repoId, repoId))
  }
}
