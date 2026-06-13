'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { deployments, repositories, users } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { checkDeploymentUrl } from '@/lib/monitoring/uptime'
import { decrypt } from '@/lib/crypto-utils'
import { revalidatePath } from 'next/cache'

export async function addDeploymentUrl(repoId: number, url: string, name?: string, provider?: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  try { new URL(url) } catch { throw new Error('Deployment URL is not a valid URL') }

  const repo = await db.query.repositories.findFirst({
    where: and(eq(repositories.id, repoId), eq(repositories.userId, session.user.id)),
  })
  if (!repo) throw new Error('Repository not found')

  // Avoid duplicates
  const existing = await db.query.deployments.findFirst({
    where: and(eq(deployments.repoId, repoId), eq(deployments.url, url)),
  })
  if (existing) return existing

  const [deployment] = await db
    .insert(deployments)
    .values({ repoId, url, name: name ?? null, provider: provider ?? null })
    .returning()

  await checkSingleDeployment(deployment.id)
  revalidatePath(`/repos/${repoId}`)
  revalidatePath('/deployments')
  return deployment
}

export async function removeDeploymentUrl(deploymentId: number) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const dep = await db.query.deployments.findFirst({
    where: eq(deployments.id, deploymentId),
    with: { repository: { columns: { userId: true, id: true } } },
  })
  if (!dep || dep.repository?.userId !== session.user.id) throw new Error('Not found')

  await db.delete(deployments).where(eq(deployments.id, deploymentId))
  revalidatePath(`/repos/${dep.repository.id}`)
  revalidatePath('/deployments')
}

export async function checkSingleDeployment(deploymentId: number) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  // Scope to user's own deployments — prevents IDOR
  const deployment = await db.query.deployments.findFirst({
    where: eq(deployments.id, deploymentId),
    with: { repository: { columns: { userId: true } } },
  })
  if (!deployment || deployment.repository?.userId !== session.user.id) return

  try {
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
  } catch (err) {
    console.warn('[deployments/checkSingle]', err instanceof Error ? err.message : err)
  }
}

export async function discoverRepoDeployments(repoId: number) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const [repo, user] = await Promise.all([
    db.query.repositories.findFirst({
      where: and(eq(repositories.id, repoId), eq(repositories.userId, session.user.id)),
    }),
    db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: { githubToken: true },
    }),
  ])

  if (!repo || !user?.githubToken) throw new Error('Not found')

  const { createOctokit } = await import('@/lib/github/client')
  const { discoverDeployments } = await import('@/lib/github/deployments')
  const octokit = createOctokit(decrypt(user.githubToken))

  const discovered = await discoverDeployments(octokit, repo.owner, repo.name)

  // Also check repo homepage as a deployment URL
  if (repo.homepage?.startsWith('http')) {
    const url = repo.homepage
    const lower = url.toLowerCase()
    const provider = lower.includes('vercel.app') || lower.includes('vercel.com') ? 'vercel'
      : lower.includes('netlify.app') ? 'netlify'
      : lower.includes('github.io') ? 'github-pages'
      : 'custom'
    const exists = discovered.find(d => d.url === url)
    if (!exists) discovered.push({ url, name: 'Homepage', provider })
  }

  // Parallel upserts — was sequential await in a loop
  const results = await Promise.allSettled(
    discovered.map(dep => addDeploymentUrl(repoId, dep.url, dep.name, dep.provider))
  )
  const added = results.filter(r => r.status === 'fulfilled').length

  return { discovered: discovered.length, added }
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
