import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Bot, TrendingUp, GitMerge, ArrowRight } from 'lucide-react'
import Link from 'next/link'

interface AgentImpactCardProps {
  merged: number
  totalScoreGained: number
  recentMergeCount: number
  successRate: number | null
}

export function AgentImpactCard({ merged, totalScoreGained, recentMergeCount, successRate }: AgentImpactCardProps) {
  if (merged === 0) return null

  return (
    <Card className="card-elevated">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Bot className="w-4 h-4 text-indigo-500" />
            Agent Impact
          </span>
          <Link href="/agent-performance" className="text-xs font-normal text-muted-foreground hover:text-foreground flex items-center gap-0.5">
            Details <ArrowRight className="w-3 h-3" />
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        <div className="flex items-center gap-4">
          <div className="text-center">
            <p className="text-2xl font-bold tabular-nums text-emerald-600">
              {totalScoreGained > 0 ? `+${totalScoreGained}` : merged}
            </p>
            <p className="text-xs text-muted-foreground">
              {totalScoreGained > 0 ? 'pts gained (30d)' : 'PRs merged'}
            </p>
          </div>
          <div className="flex-1 space-y-1.5">
            <div className="flex items-center gap-2 text-xs">
              <GitMerge className="w-3 h-3 text-emerald-500 shrink-0" />
              <span className="text-muted-foreground">
                {recentMergeCount} merged this month
              </span>
            </div>
            {successRate != null && (
              <div className="flex items-center gap-2 text-xs">
                <TrendingUp className="w-3 h-3 text-indigo-500 shrink-0" />
                <span className={successRate >= 80 ? 'text-emerald-600 font-medium' : 'text-amber-600 font-medium'}>
                  {successRate}% success rate
                </span>
              </div>
            )}
          </div>
        </div>

        {totalScoreGained === 0 && merged > 0 && (
          <p className="text-xs text-muted-foreground">
            Score attribution available after repos resync post-merge.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
