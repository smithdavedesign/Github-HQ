import type { RepositoryMetrics } from '@/lib/db/schema'

/**
 * PRD formula:
 *   20% activity · 20% security · 15% deployment · 15% documentation
 *   10% testing · 10% dependency · 10% quality
 */
export function calculateHealthScore(
  metrics: Pick<
    RepositoryMetrics,
    | 'activityScore'
    | 'securityScore'
    | 'documentationScore'
    | 'testingScore'
    | 'dependencyScore'
    | 'qualityScore'
  > & { deploymentScore?: number },
): number {
  const activity = (metrics.activityScore ?? 0) * 0.20
  const security = (metrics.securityScore ?? 100) * 0.20
  const deployment = (metrics.deploymentScore ?? 50) * 0.15
  const documentation = (metrics.documentationScore ?? 0) * 0.15
  const testing = (metrics.testingScore ?? 0) * 0.10
  const dependency = (metrics.dependencyScore ?? 50) * 0.10
  const quality = (metrics.qualityScore ?? 70) * 0.10

  return Math.round(activity + security + deployment + documentation + testing + dependency + quality)
}

export function healthColor(score: number): 'green' | 'yellow' | 'red' {
  if (score >= 90) return 'green'
  if (score >= 70) return 'yellow'
  return 'red'
}

export function healthLabel(score: number): 'Healthy' | 'At Risk' | 'Dead' {
  if (score >= 90) return 'Healthy'
  if (score >= 70) return 'At Risk'
  return 'Dead'
}
