'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { deployments, repositories } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { checkDeploymentUrl } from '@/lib/monitoring/uptime'

export async function addDeploymentUrl(repoId: number, url: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  // Verify the repo belongs to this user
  const repo = await db.query.repositories.findFirst({
    where: and(eq(repositories.id, repoId), eq(repositories.userId, session.user.id)),
  })
  if (!repo) throw new Error('Repository not found')

  const [deployment] = await db
    .insert(deployments)
    .values({ repoId, url })
    .returning()

  // Run initial check immediately
  await checkSingleDeployment(deployment.id)

  return deployment
}

export async function checkSingleDeployment(deploymentId: number) {
  const deployment = await db.query.deployments.findFirst({
    where: eq(deployments.id, deploymentId),
  })
  if (!deployment) return

  const result = await checkDeploymentUrl(deployment.url)
  await db
    .update(deployments)
    .set({
      status: result.status,
      responseTimeMs: result.responseTimeMs,
      httpStatus: result.httpStatus,
      sslValid: result.sslValid,
      lastChecked: new Date(),
    })
    .where(eq(deployments.id, deploymentId))
}

export async function getDeployments() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  return db.query.deployments.findMany({
    with: {
      repository: {
        columns: { name: true, fullName: true, visibility: true },
      },
    },
    where: (d, { inArray }) =>
      inArray(
        d.repoId,
        db
          .select({ id: repositories.id })
          .from(repositories)
          .where(eq(repositories.userId, session.user.id))
      ),
  })
}
