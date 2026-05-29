'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { repositories, repositoryMetrics, techStack, deployments, securityFindings } from '@/lib/db/schema'
import { eq, desc, and, sql } from 'drizzle-orm'

export async function getRepositories() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  return db.query.repositories.findMany({
    where: eq(repositories.userId, session.user.id),
    with: {
      metrics: true,
      techStack: true,
      deployments: true,
      securityFindings: {
        where: eq(securityFindings.state, 'open'),
      },
    },
    orderBy: [desc(repositoryMetrics.healthScore)],
  })
}

export async function getRepositoryById(id: number) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  return db.query.repositories.findFirst({
    where: and(eq(repositories.id, id), eq(repositories.userId, session.user.id)),
    with: {
      metrics: true,
      techStack: true,
      deployments: true,
      securityFindings: true,
    },
  })
}

export async function getDashboardStats() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const userId = session.user.id

  const [repoStats, securityStats] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)`.mapWith(Number),
        private: sql<number>`count(*) filter (where ${repositories.visibility} = 'private')`.mapWith(Number),
        public: sql<number>`count(*) filter (where ${repositories.visibility} = 'public')`.mapWith(Number),
        healthy: sql<number>`count(*) filter (where ${repositoryMetrics.healthScore} >= 90)`.mapWith(Number),
        atRisk: sql<number>`count(*) filter (where ${repositoryMetrics.healthScore} >= 70 and ${repositoryMetrics.healthScore} < 90)`.mapWith(Number),
        dead: sql<number>`count(*) filter (where ${repositoryMetrics.healthScore} < 70)`.mapWith(Number),
        avgHealth: sql<number>`avg(${repositoryMetrics.healthScore})`.mapWith(Number),
      })
      .from(repositories)
      .leftJoin(repositoryMetrics, eq(repositories.id, repositoryMetrics.repoId))
      .where(eq(repositories.userId, userId)),

    db
      .select({
        critical: sql<number>`count(*) filter (where ${securityFindings.severity} = 'critical' and ${securityFindings.state} = 'open')`.mapWith(Number),
        high: sql<number>`count(*) filter (where ${securityFindings.severity} = 'high' and ${securityFindings.state} = 'open')`.mapWith(Number),
      })
      .from(securityFindings)
      .innerJoin(repositories, eq(securityFindings.repoId, repositories.id))
      .where(eq(repositories.userId, userId)),
  ])

  return {
    ...repoStats[0],
    securityIssues: (securityStats[0]?.critical ?? 0) + (securityStats[0]?.high ?? 0),
  }
}

export async function toggleRevenueGenerating(repoId: number, value: boolean) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  await db
    .update(repositories)
    .set({ isRevenueGenerating: value })
    .where(and(eq(repositories.id, repoId), eq(repositories.userId, session.user.id)))
}
