import { db } from '@/lib/db'
import { securityFindings, repositoryMetrics, repositories } from '@/lib/db/schema'
import type { OctokitClient } from './client'
import { eq, and } from 'drizzle-orm'
import { calculateHealthScore } from '@/lib/health/scoring'

const SEVERITY_PENALTY: Record<string, number> = {
  critical: 25,
  high: 15,
  medium: 5,
  low: 2,
}

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

  // Clear and re-insert findings for this repo
  await db.delete(securityFindings).where(
    and(eq(securityFindings.repoId, repoId), eq(securityFindings.state, 'open'))
  )

  let penaltyTotal = 0

  if (dependabotAlerts.status === 'fulfilled') {
    for (const alert of dependabotAlerts.value) {
      const severity = (alert.security_advisory?.severity ?? 'medium').toLowerCase()
      penaltyTotal += SEVERITY_PENALTY[severity] ?? 2

      await db.insert(securityFindings).values({
        repoId,
        githubAlertId: alert.number,
        type: 'dependabot',
        severity,
        title: alert.security_advisory?.summary ?? alert.dependency?.package?.name ?? 'Dependency alert',
        description: alert.security_advisory?.description,
        packageName: alert.dependency?.package?.name,
        state: 'open',
        createdAt: new Date(alert.created_at),
      })
    }
  }

  if (secretAlerts.status === 'fulfilled') {
    for (const alert of secretAlerts.value) {
      penaltyTotal += SEVERITY_PENALTY['high'] // secret leaks are always high severity

      await db.insert(securityFindings).values({
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

  const securityScore = Math.max(0, 100 - penaltyTotal)

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
