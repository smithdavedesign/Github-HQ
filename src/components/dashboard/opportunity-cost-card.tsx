import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { OpportunityCostResult } from '@/lib/health/opportunity-cost'
import { TrendingDown, TrendingUp, AlertCircle } from 'lucide-react'
import Link from 'next/link'

interface Props { result: OpportunityCostResult }

export function OpportunityCostCard({ result }: Props) {
  if (!result.hasSignificantCost) return null

  return (
    <Card className="card-elevated border-amber-500/20 bg-amber-500/[0.03]">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <AlertCircle className="w-4 h-4 text-amber-500" />
          <CardTitle className="text-sm font-semibold">Opportunity Cost</CardTitle>
          <span className="ml-auto text-xs font-medium text-amber-500">
            +{result.scoreDelta} pts left on the table
          </span>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {/* What you worked on */}
        {result.workedOn.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <TrendingUp className="w-3.5 h-3.5" /> This week you committed to
            </p>
            {result.workedOn.map(r => (
              <div key={r.id} className="flex items-center justify-between text-xs">
                <Link href={`/repos/${r.id}`} className="font-medium hover:underline">{r.name}</Link>
                <span className="text-muted-foreground">opp {Math.round(r.opportunityScore)}</span>
              </div>
            ))}
          </div>
        )}

        <div className="border-t border-border/40 pt-3 space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
            <TrendingDown className="w-3.5 h-3.5 text-amber-500" /> Higher-value repos untouched
          </p>
          {result.topMissed.map((r, i) => (
            <div key={r.id} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground">{i + 1}.</span>
                <Link href={`/repos/${r.id}`} className="font-medium hover:underline">{r.name}</Link>
              </div>
              <span className="font-medium text-amber-500">opp {Math.round(r.opportunityScore)}</span>
            </div>
          ))}
        </div>

        <p className="text-xs text-muted-foreground pt-1 border-t border-border/40">
          Avg score of work done: {result.avgWorkedScore} · Top untouched: {result.topMissedScore}
        </p>
      </CardContent>
    </Card>
  )
}
