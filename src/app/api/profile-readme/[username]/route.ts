import { db } from '@/lib/db'
import { users, repositories } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { getShowcaseRecommendations } from '@/lib/health/showcase'

export async function GET(_req: Request, { params }: { params: Promise<{ username: string }> }) {
  const { username } = await params

  const user = await db.query.users.findFirst({
    where: eq(users.githubLogin, username),
    columns: { id: true, name: true, publicProfile: true },
  })

  if (!user?.publicProfile) {
    return new Response('Not found', { status: 404 })
  }

  const rows = await db.query.repositories.findMany({
    where: and(eq(repositories.userId, user.id)),
    with: {
      metrics: { columns: { healthScore: true, activityStatus: true, opportunityScore: true } },
      deployments: { columns: { status: true } },
    },
    columns: {
      id: true, name: true, description: true, visibility: true,
      stars: true, isFocused: true, purpose: true,
      lifecycleStatus: true, language: true, mrr: true, isArchived: true,
    },
  })

  const inputs = rows.map(r => ({
    id: r.id,
    name: r.name,
    description: r.description,
    visibility: r.visibility,
    stars: r.stars ?? 0,
    healthScore: r.metrics?.healthScore ?? 0,
    isFocused: r.isFocused ?? false,
    hasDeployment: r.deployments.some(d => d.status === 'healthy' || d.status === 'slow'),
    purpose: r.purpose,
    lifecycleStatus: r.lifecycleStatus,
    activityStatus: r.metrics?.activityStatus ?? null,
    language: r.language,
  }))

  const topRepos = getShowcaseRecommendations(inputs, 6)
  const focused = rows.filter(r => r.isFocused && r.lifecycleStatus !== 'archived' && r.lifecycleStatus !== 'sunsetting')
  const activeCount = rows.filter(r => !r.isArchived && r.lifecycleStatus !== 'archived').length
  const totalMrr = rows.reduce((s, r) => s + parseFloat(String(r.mrr ?? '0')), 0)
  const deployedCount = rows.filter(r => r.deployments?.some(d => d.status === 'healthy')).length

  const lines: string[] = [
    `### Hi, I'm ${user.name ?? username} 👋`,
    ``,
  ]

  if (focused.length > 0) {
    lines.push(`**Currently building:** ${focused.map(r => `[${r.name}](https://github.com/${username}/${r.name})`).join(' · ')}`)
    lines.push(``)
  }

  if (topRepos.length > 0) {
    lines.push(`**Featured projects:**`)
    for (const r of topRepos.slice(0, 4)) {
      const desc = r.description ? ` — ${r.description}` : ''
      const stars = r.stars > 0 ? ` ⭐ ${r.stars}` : ''
      lines.push(`- [${r.name}](https://github.com/${username}/${r.name})${desc}${stars}`)
    }
    lines.push(``)
  }

  lines.push(`**Portfolio stats:**`)
  lines.push(`- ${activeCount} active repos · ${deployedCount} deployed`)
  if (totalMrr > 0) lines.push(`- $${totalMrr.toFixed(0)}/mo MRR`)
  lines.push(``)
  lines.push(`*Portfolio tracked with [RepoHQ](https://repohq.vercel.app)*`)

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  })
}
