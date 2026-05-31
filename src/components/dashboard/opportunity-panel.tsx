import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { HealthBadge } from '@/components/repos/health-badge'
import { Target, TrendingDown, ArrowRight } from 'lucide-react'
import { opportunityLabel } from '@/lib/health/scoring'

interface RepoSummary {
  id: number
  name: string
  description: string | null
  opportunityScore: number
  healthScore: number
  activityStatus: string | null
  stars: number
  mrr: string | null
  isRevenueGenerating: boolean | null
}

interface OpportunityPanelProps {
  needsAttention: RepoSummary[]   // high opportunity, poor health
  highPotentialDormant: RepoSummary[] // high opportunity, low/no activity
}

function OpportunityBadge({ score }: { score: number }) {
  const label = opportunityLabel(score)
  const styles = {
    High: 'bg-violet-500/10 text-violet-600 border-violet-500/20',
    Medium: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
    Low: 'bg-slate-500/10 text-slate-500 border-slate-500/20',
  }
  return (
    <Badge variant="outline" className={`text-xs ${styles[label as keyof typeof styles]}`}>
      {score} · {label}
    </Badge>
  )
}

function RepoRow({ repo }: { repo: RepoSummary }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5 border-b last:border-0">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <Link href={`/repos/${repo.id}`} className="text-sm font-medium hover:underline">
            {repo.name}
          </Link>
          {repo.isRevenueGenerating && (
            <span className="text-xs text-emerald-600">$</span>
          )}
        </div>
        {repo.description && (
          <p className="text-xs text-muted-foreground truncate max-w-xs mt-0.5">
            {repo.description}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <OpportunityBadge score={repo.opportunityScore} />
        <HealthBadge score={repo.healthScore} />
        <Link href={`/repos/${repo.id}`} className="text-muted-foreground hover:text-foreground">
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  )
}

export function OpportunityPanel({ needsAttention, highPotentialDormant }: OpportunityPanelProps) {
  if (needsAttention.length === 0 && highPotentialDormant.length === 0) return null

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Needs attention — high opportunity but poor health */}
      {needsAttention.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Target className="w-4 h-4 text-violet-500" />
              Needs Attention
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              High opportunity score, health below 70 — worth investing in
            </p>
          </CardHeader>
          <CardContent className="p-0 px-6 pb-4">
            {needsAttention.map(repo => (
              <RepoRow key={repo.id} repo={repo} />
            ))}
          </CardContent>
        </Card>
      )}

      {/* Abandoned but high-potential */}
      {highPotentialDormant.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingDown className="w-4 h-4 text-amber-500" />
              Dormant but Promising
            </CardTitle>
            <p className="text-xs text-muted-foreground">
              High opportunity score, low or no recent activity — candidate for revival
            </p>
          </CardHeader>
          <CardContent className="p-0 px-6 pb-4">
            {highPotentialDormant.map(repo => (
              <RepoRow key={repo.id} repo={repo} />
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
