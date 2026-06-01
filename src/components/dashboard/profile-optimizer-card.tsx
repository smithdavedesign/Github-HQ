import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { ShowcaseRepo } from '@/lib/health/showcase'
import { HealthBadge } from '@/components/repos/health-badge'
import { Badge } from '@/components/ui/badge'
import { Star, ExternalLink, GitBranch } from 'lucide-react'
import Link from 'next/link'

interface Props {
  repos: ShowcaseRepo[]
  githubLogin: string | null | undefined
}

export function ProfileOptimizerCard({ repos, githubLogin }: Props) {
  if (repos.length === 0) return null

  return (
    <Card className="card-elevated">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <GitBranch className="w-4 h-4" />
              GitHub Profile
            </CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">
              Top {repos.length} repos to pin — ranked by health, stars, focus, and deployment
            </p>
          </div>
          {githubLogin && (
            <a
              href={`https://github.com/${githubLogin}?tab=repositories`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              Open profile <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="space-y-2">
          {repos.map((repo, i) => (
            <div key={repo.id} className="flex items-center gap-3">
              <span className="text-xs font-mono text-muted-foreground w-4 shrink-0">{i + 1}.</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <Link href={`/repos/${repo.id}`} className="text-sm font-medium hover:underline truncate">
                    {repo.name}
                  </Link>
                  {repo.isFocused && <Star className="w-3 h-3 text-amber-400 fill-amber-400 shrink-0" />}
                  {repo.language && (
                    <span className="text-[10px] text-muted-foreground">{repo.language}</span>
                  )}
                  {repo.purpose && (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">{repo.purpose}</Badge>
                  )}
                </div>
                {repo.description && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">{repo.description}</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {(repo.stars ?? 0) > 0 && (
                  <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                    <Star className="w-3 h-3" />{repo.stars}
                  </span>
                )}
                <HealthBadge score={Math.round(repo.healthScore)} />
              </div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground mt-3 pt-3 border-t border-border/40">
          Pin these on your GitHub profile for a clean, high-signal portfolio.
          {githubLogin && (
            <> <a href={`https://github.com/${githubLogin}`} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground">View your profile →</a></>
          )}
        </p>
      </CardContent>
    </Card>
  )
}
