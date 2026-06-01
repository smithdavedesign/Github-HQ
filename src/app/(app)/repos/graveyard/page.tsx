import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { repositories } from '@/lib/db/schema'
import { eq, and, inArray } from 'drizzle-orm'
import { HealthBadge } from '@/components/repos/health-badge'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { formatDistanceToNow } from '@/lib/utils'
import { Skull, ExternalLink, CheckCircle } from 'lucide-react'
import Link from 'next/link'
import { ArchiveOnGitHubButton } from '@/components/repos/archive-on-github-button'

export default async function GraveyardPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const archived = await db.query.repositories.findMany({
    where: and(
      eq(repositories.userId, session.user.id),
      inArray(repositories.lifecycleStatus, ['sunsetting', 'archived']),
    ),
    with: { metrics: true },
    columns: {
      id: true, name: true, description: true, language: true,
      lifecycleStatus: true, abandonmentReason: true, updatedAt: true,
      homepage: true, stars: true, isArchived: true,
    },
    orderBy: (r, { desc }) => [desc(r.updatedAt)],
  })

  const reasonCounts: Record<string, number> = {}
  for (const r of archived) {
    if (r.abandonmentReason) {
      reasonCounts[r.abandonmentReason] = (reasonCounts[r.abandonmentReason] ?? 0) + 1
    }
  }
  const topReason = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1])[0]?.[0]

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <Skull className="w-5 h-5 text-muted-foreground" />
          <h1 className="text-2xl font-bold tracking-tight">Idea Graveyard</h1>
        </div>
        <p className="text-muted-foreground text-sm mt-1">
          {archived.length} repo{archived.length !== 1 ? 's' : ''} shelved
          {topReason ? ` · Most common reason: "${topReason}"` : ''}
        </p>
      </div>

      {archived.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No repos marked as Sunsetting or Archived yet.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {archived.map(repo => (
            <Card key={repo.id} className="card-elevated border-border/60">
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link href={`/repos/${repo.id}`} className="font-semibold text-sm hover:underline">
                        {repo.name}
                      </Link>
                      <Badge variant="outline" className={`text-xs ${repo.lifecycleStatus === 'archived' ? 'bg-slate-100 text-slate-600 border-slate-200' : 'bg-orange-50 text-orange-600 border-orange-200'}`}>
                        {repo.lifecycleStatus}
                      </Badge>
                      {repo.homepage && (
                        <a href={repo.homepage} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground">
                          <ExternalLink className="w-3.5 h-3.5" />
                        </a>
                      )}
                    </div>

                    {repo.description && (
                      <p className="text-xs text-muted-foreground mt-1">{repo.description}</p>
                    )}

                    <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                      {repo.language && <span>{repo.language}</span>}
                      {(repo.stars ?? 0) > 0 && <span>⭐ {repo.stars}</span>}
                      <span>Last updated {formatDistanceToNow(repo.updatedAt)}</span>
                    </div>

                    {repo.abandonmentReason && (
                      <div className="mt-2">
                        <Badge variant="secondary" className="text-xs gap-1">
                          <Skull className="w-2.5 h-2.5" />
                          {repo.abandonmentReason}
                        </Badge>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-2 shrink-0">
                    {repo.metrics?.healthScore != null && (
                      <HealthBadge score={Math.round(repo.metrics.healthScore)} />
                    )}
                    {repo.isArchived ? (
                      <div className="flex items-center gap-1 text-xs text-emerald-600">
                        <CheckCircle className="w-3 h-3" />
                        On GitHub
                      </div>
                    ) : (
                      <ArchiveOnGitHubButton repoId={repo.id} repoName={repo.name} />
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <p className="text-center text-xs text-muted-foreground">
        <Link href="/repos" className="underline hover:text-foreground">← Back to all repos</Link>
      </p>
    </div>
  )
}
