import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Clock, TrendingUp } from 'lucide-react'
import Link from 'next/link'
import type { TimeAllocationItem } from '@/lib/health/scoring'

interface TimeAllocationCardProps {
  items: TimeAllocationItem[]
  hoursPerWeek?: number
}

export function TimeAllocationCard({ items, hoursPerWeek = 10 }: TimeAllocationCardProps) {
  if (items.length === 0) return null

  return (
    <Card className="card-elevated border-border/60">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-sky-50 dark:bg-sky-950/50 flex items-center justify-center">
            <Clock className="w-4 h-4 text-sky-600 dark:text-sky-400" />
          </div>
          <div>
            <CardTitle className="text-sm font-semibold">
              Best Use of Your Next {hoursPerWeek}h
            </CardTitle>
            <p className="text-xs text-muted-foreground">Ranked by projected value uplift</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {items.map((item, idx) => (
          <div
            key={item.repoId}
            className="flex items-start gap-3 p-2.5 rounded-lg border border-border/60 bg-muted/30"
          >
            {/* Rank bubble */}
            <span className="w-5 h-5 rounded-full bg-sky-100 dark:bg-sky-950/60 flex items-center justify-center text-sky-700 dark:text-sky-400 text-[11px] font-bold shrink-0 mt-0.5">
              {idx + 1}
            </span>

            <div className="min-w-0 flex-1">
              <Link
                href={`/repos/${item.repoId}`}
                className="text-sm font-medium hover:underline block truncate"
              >
                {item.repoName}
              </Link>
              <p className="text-xs text-muted-foreground truncate mt-0.5">{item.rationale}</p>
            </div>

            <div className="shrink-0 flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <TrendingUp className="w-3.5 h-3.5" />
              <span className="text-xs font-semibold tabular-nums">
                +${item.projectedValueDelta.toLocaleString()}
              </span>
            </div>
          </div>
        ))}

        <p className="text-xs text-muted-foreground pt-1">
          Projected value based on health gap, opportunity gap, and revenue potential.
          {' '}<Link href="/repos" className="underline">View all repos →</Link>
        </p>
      </CardContent>
    </Card>
  )
}
