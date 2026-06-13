import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { users, repositories, repositoryMetrics, techStack, deployments } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { HealthBadge, ActivityBadge } from '@/components/repos/health-badge'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Card, CardContent } from '@/components/ui/card'
import { ExternalLink, GitFork, Star, Globe, Lock, CheckCircle, XCircle, AlertTriangle } from 'lucide-react'
import Link from 'next/link'

// Revalidate every hour — this is a public semi-static page
export const revalidate = 3600

type Props = { params: Promise<{ username: string }> }

export async function generateMetadata({ params }: Props) {
  const { username } = await params
  return {
    title: `${username}'s Portfolio — RepoHQ`,
    description: `GitHub portfolio health dashboard for @${username}`,
  }
}

export default async function PublicPortfolioPage({ params }: Props) {
  const { username } = await params

  // Look up user by githubLogin, must have public profile enabled
  const user = await db.query.users.findFirst({
    where: and(eq(users.githubLogin, username), eq(users.publicProfile, true)),
    columns: { id: true, name: true, image: true, githubLogin: true, lastSyncedAt: true },
  })

  if (!user) notFound()

  // Fetch only public repos with their metrics, stack, and deployments
  const publicRepos = await db.query.repositories.findMany({
    where: and(eq(repositories.userId, user.id), eq(repositories.visibility, 'public')),
    with: {
      metrics: true,
      techStack: true,
      deployments: true,
    },
    columns: {
      id: true, name: true, fullName: true, description: true,
      visibility: true, language: true, stars: true, forks: true,
      homepage: true, isArchived: true, aiSummary: true,
    },
  })

  const sorted = publicRepos
    .filter(r => !r.isArchived)
    .sort((a, b) => (b.metrics?.healthScore ?? 0) - (a.metrics?.healthScore ?? 0))

  const total = publicRepos.length
  const avgHealth = sorted.length > 0
    ? Math.round(sorted.reduce((sum, r) => sum + (r.metrics?.healthScore ?? 0), 0) / sorted.length)
    : 0
  const healthy = sorted.filter(r => (r.metrics?.healthScore ?? 0) >= 90).length

  // Language breakdown (top 4)
  const langCounts: Record<string, number> = {}
  for (const r of sorted) {
    const lang = r.techStack?.language ?? r.language
    if (lang) langCounts[lang] = (langCounts[lang] ?? 0) + 1
  }
  const topLangs = Object.entries(langCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([l]) => l)

  const initials = user.name?.split(' ').map(n => n[0]).join('').toUpperCase() ?? '?'

  function DeploymentDot({ deps }: { deps: typeof sorted[0]['deployments'] }) {
    if (deps.length === 0) return null
    const status = deps[0].status
    return status === 'healthy'
      ? <span title="Deployment healthy"><CheckCircle className="w-3 h-3 text-emerald-500" /></span>
      : status === 'slow'
        ? <span title="Deployment slow"><AlertTriangle className="w-3 h-3 text-amber-500" /></span>
        : status === 'down'
          ? <span title="Deployment down"><XCircle className="w-3 h-3 text-red-500" /></span>
          : null
  }

  return (
    <div className="min-h-screen page-content">
      <div className="max-w-4xl mx-auto px-4 py-12 space-y-8">

        {/* Profile header */}
        <div className="flex items-start gap-5 flex-wrap">
          <Avatar className="w-16 h-16 shrink-0">
            <AvatarImage src={user.image ?? undefined} alt={user.name ?? username} />
            <AvatarFallback className="text-lg">{initials}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">{user.name ?? username}</h1>
            <a
              href={`https://github.com/${username}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 w-fit"
            >
              <Globe className="w-3.5 h-3.5" />
              @{username}
            </a>

            {/* Stats row */}
            <div className="flex items-center gap-5 mt-3 flex-wrap text-sm">
              <span className="flex items-center gap-1.5">
                <GitFork className="w-4 h-4 text-muted-foreground" />
                <strong>{total}</strong> public repos
              </span>
              <span className="flex items-center gap-1.5">
                Avg health <HealthBadge score={avgHealth} />
                <span className="text-xs text-muted-foreground">
                  ({avgHealth >= 80 ? 'good' : avgHealth >= 55 ? 'fair' : 'developing'})
                </span>
              </span>
              <span className="text-muted-foreground">
                {healthy} healthy
              </span>
              {topLangs.length > 0 && (
                <div className="flex gap-1 flex-wrap">
                  {topLangs.map(l => (
                    <Badge key={l} variant="secondary" className="text-xs">{l}</Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="text-right text-xs text-muted-foreground shrink-0">
            <p>Powered by</p>
            <Link href="/" className="font-semibold text-foreground hover:underline">RepoHQ</Link>
          </div>
        </div>

        {/* Repos grid */}
        <div className="space-y-3">
          {sorted.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground text-sm">
                No public repositories found.
              </CardContent>
            </Card>
          ) : (
            sorted.map(repo => {
              const summary = repo.aiSummary as { what_it_does?: string } | null
              const stack = repo.techStack
              const stackPills = [
                stack?.frontend, stack?.language, stack?.database, stack?.hosting,
              ].filter(Boolean).slice(0, 3)

              return (
                <Card key={repo.id} className="hover:shadow-sm transition-shadow">
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3 flex-wrap">
                      <div className="flex-1 min-w-0 space-y-1.5">
                        {/* Name row */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <a
                            href={`https://github.com/${repo.fullName}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-semibold text-sm hover:underline"
                          >
                            {repo.name}
                          </a>
                          <DeploymentDot deps={repo.deployments} />
                          {repo.homepage && (
                            <a
                              href={repo.homepage}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-0.5"
                            >
                              <ExternalLink className="w-3 h-3" />
                              Live
                            </a>
                          )}
                        </div>

                        {/* Description or AI summary */}
                        {(summary?.what_it_does ?? repo.description) && (
                          <p className="text-xs text-muted-foreground line-clamp-2">
                            {summary?.what_it_does ?? repo.description}
                          </p>
                        )}

                        {/* Stack + stats */}
                        <div className="flex items-center gap-2 flex-wrap">
                          {stackPills.map(p => (
                            <Badge key={p} variant="outline" className="text-xs">{p}</Badge>
                          ))}
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Star className="w-3 h-3" /> {repo.stars}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {repo.metrics?.activityStatus ?? ''}
                          </span>
                        </div>
                      </div>

                      {/* Health badge */}
                      {repo.metrics?.healthScore != null && (
                        <HealthBadge score={repo.metrics.healthScore} />
                      )}
                    </div>
                  </CardContent>
                </Card>
              )
            })
          )}
        </div>

        <p className="text-center text-xs text-muted-foreground pt-4">
          Portfolio health monitored by{' '}
          <Link href="/" className="underline hover:text-foreground">RepoHQ</Link>
          {user.lastSyncedAt && ` · Updated ${new Date(user.lastSyncedAt).toLocaleDateString()}`}
        </p>
      </div>
    </div>
  )
}
