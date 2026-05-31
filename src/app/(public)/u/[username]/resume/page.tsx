import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { users, repositories } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { HealthBadge } from '@/components/repos/health-badge'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { GitBranch, Globe, Star, ExternalLink, CheckCircle } from 'lucide-react'
import Link from 'next/link'
import type { Metadata } from 'next'

export const revalidate = 3600

type Props = { params: Promise<{ username: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params
  return {
    title: `${username} — Engineering Portfolio`,
    description: `Software engineering portfolio for @${username}, powered by RepoHQ`,
  }
}

export default async function PortfolioResumePage({ params }: Props) {
  const { username } = await params

  const user = await db.query.users.findFirst({
    where: and(eq(users.githubLogin, username), eq(users.publicProfile, true)),
    columns: { id: true, name: true, image: true, githubLogin: true, lastSyncedAt: true },
  })
  if (!user) notFound()

  const publicRepos = await db.query.repositories.findMany({
    where: and(eq(repositories.userId, user.id), eq(repositories.visibility, 'public')),
    with: { metrics: true, techStack: true, deployments: true },
    columns: {
      id: true, name: true, description: true, language: true,
      stars: true, homepage: true, isArchived: true, aiSummary: true,
    },
  })

  const active = publicRepos
    .filter(r => !r.isArchived)
    .sort((a, b) => (b.metrics?.healthScore ?? 0) - (a.metrics?.healthScore ?? 0))

  const avgHealth = active.length > 0
    ? Math.round(active.reduce((s, r) => s + (r.metrics?.healthScore ?? 0), 0) / active.length)
    : 0

  const inProduction = active.filter(r =>
    r.deployments.some(d => d.status === 'healthy' || d.status === 'slow')
  ).length

  // Language distribution
  const langMap: Record<string, number> = {}
  for (const r of active) {
    const lang = r.techStack?.language ?? r.language
    if (lang) langMap[lang] = (langMap[lang] ?? 0) + 1
  }
  const topLangs = Object.entries(langMap).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([l]) => l)

  // Tech diversity
  const frameworks = [...new Set(active.map(r => r.techStack?.frontend).filter(Boolean))].slice(0, 5)
  const databases = [...new Set(active.map(r => r.techStack?.database).filter(Boolean))].slice(0, 4)
  const hostingPlatforms = [...new Set(active.map(r => r.techStack?.hosting).filter(Boolean))].slice(0, 4)

  const initials = user.name?.split(' ').map(n => n[0]).join('').toUpperCase() ?? '?'

  return (
    <div className="min-h-screen page-content print:bg-white">
      <div className="max-w-3xl mx-auto px-6 py-12 space-y-10">

        {/* Header */}
        <div className="flex items-start gap-6 flex-wrap">
          <Avatar className="w-20 h-20 ring-2 ring-border shrink-0">
            <AvatarImage src={user.image ?? undefined} alt={user.name ?? username} />
            <AvatarFallback className="text-xl font-bold bg-indigo-600 text-white">{initials}</AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <h1 className="text-3xl font-bold tracking-tight">{user.name ?? username}</h1>
            <a
              href={`https://github.com/${username}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1 mt-1 w-fit"
            >
              <Globe className="w-3.5 h-3.5" />
              github.com/{username}
            </a>

            {/* Stats bar */}
            <div className="flex items-center gap-5 mt-4 flex-wrap text-sm">
              <div className="text-center">
                <p className="text-2xl font-bold tabular-nums">{active.length}</p>
                <p className="text-xs text-muted-foreground">Public repos</p>
              </div>
              <div className="w-px h-8 bg-border" />
              <div className="text-center">
                <p className="text-2xl font-bold tabular-nums">{avgHealth}</p>
                <p className="text-xs text-muted-foreground">Avg health</p>
              </div>
              <div className="w-px h-8 bg-border" />
              <div className="text-center">
                <p className="text-2xl font-bold tabular-nums">{inProduction}</p>
                <p className="text-xs text-muted-foreground">In production</p>
              </div>
              <div className="w-px h-8 bg-border" />
              <div className="text-center">
                <p className="text-2xl font-bold tabular-nums">{topLangs.length}</p>
                <p className="text-xs text-muted-foreground">Languages</p>
              </div>
            </div>
          </div>
        </div>

        <div className="h-px bg-border" />

        {/* Skills */}
        <div className="space-y-5">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Technical Skills</h2>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-5 text-sm">
            {topLangs.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Languages</p>
                <div className="flex flex-wrap gap-1.5">
                  {topLangs.map(l => (
                    <Badge key={l} variant="secondary" className="text-xs">{l}</Badge>
                  ))}
                </div>
              </div>
            )}
            {frameworks.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Frameworks</p>
                <div className="flex flex-wrap gap-1.5">
                  {frameworks.map(f => (
                    <Badge key={f} variant="secondary" className="text-xs">{f}</Badge>
                  ))}
                </div>
              </div>
            )}
            {databases.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Databases</p>
                <div className="flex flex-wrap gap-1.5">
                  {databases.map(d => (
                    <Badge key={d} variant="secondary" className="text-xs">{d}</Badge>
                  ))}
                </div>
              </div>
            )}
            {hostingPlatforms.length > 0 && (
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-2">Hosting</p>
                <div className="flex flex-wrap gap-1.5">
                  {hostingPlatforms.map(h => (
                    <Badge key={h} variant="secondary" className="text-xs">{h}</Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="h-px bg-border" />

        {/* Top projects */}
        <div className="space-y-4">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">Projects</h2>

          <div className="space-y-4">
            {active.slice(0, 10).map(repo => {
              const summary = (repo.aiSummary as { what_it_does?: string } | null)?.what_it_does
              const stack = repo.techStack
              const isLive = repo.deployments.some(d => d.status === 'healthy')
              const stackPills = [stack?.frontend ?? stack?.language, stack?.database, stack?.hosting]
                .filter(Boolean).slice(0, 3) as string[]

              return (
                <div key={repo.id} className="flex gap-4">
                  <div className="w-px bg-indigo-200 dark:bg-indigo-800 shrink-0 mt-1 ml-2" />
                  <div className="flex-1 min-w-0 pb-4">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <a
                            href={`https://github.com/${username}/${repo.name}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-semibold text-sm hover:underline"
                          >
                            {repo.name}
                          </a>
                          {isLive && <span title="In production"><CheckCircle className="w-3.5 h-3.5 text-emerald-500" /></span>}
                          {repo.homepage && (
                            <a href={repo.homepage} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                          {(repo.stars ?? 0) > 0 && (
                            <span className="flex items-center gap-0.5 text-xs text-muted-foreground">
                              <Star className="w-3 h-3" />{repo.stars ?? 0}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 leading-relaxed max-w-lg">
                          {summary ?? repo.description ?? ''}
                        </p>
                        {stackPills.length > 0 && (
                          <div className="flex gap-1.5 mt-2 flex-wrap">
                            {stackPills.map(p => (
                              <Badge key={p} variant="outline" className="text-[10px] h-4 px-1.5">{p}</Badge>
                            ))}
                          </div>
                        )}
                      </div>
                      {repo.metrics?.healthScore != null && (
                        <HealthBadge score={Math.round(repo.metrics.healthScore)} />
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="h-px bg-border" />
        <div className="flex items-center justify-between text-xs text-muted-foreground flex-wrap gap-2">
          <span>
            Portfolio at{' '}
            <Link href={`/u/${username}`} className="underline hover:text-foreground">
              repohq.vercel.app/u/{username}
            </Link>
            {user.lastSyncedAt && ` · Updated ${new Date(user.lastSyncedAt).toLocaleDateString()}`}
          </span>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 rounded bg-indigo-600 flex items-center justify-center">
              <GitBranch className="w-2.5 h-2.5 text-white" />
            </div>
            <span>Powered by RepoHQ</span>
          </div>
        </div>
      </div>
    </div>
  )
}
