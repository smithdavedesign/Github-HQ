import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Grid2x2 } from 'lucide-react'
import { getQuadrant, type EffortLevel } from '@/lib/effort'

interface MatrixRepo {
  id: number
  name: string
  opportunityScore: number
  estimatedEffort: string | null
}

interface EffortMatrixProps {
  repos: MatrixRepo[]
}

const QUADRANT_STYLES = {
  'Quick Win':    'border-emerald-200 bg-emerald-50/50 dark:border-emerald-900/50 dark:bg-emerald-950/20',
  'Invest':       'border-blue-200 bg-blue-50/50 dark:border-blue-900/50 dark:bg-blue-950/20',
  'Fill-In':      'border-slate-200 bg-slate-50/30 dark:border-slate-800 dark:bg-slate-900/20',
  'Deprioritize': 'border-red-100 bg-red-50/20 dark:border-red-900/30 dark:bg-red-950/10',
}

export function EffortMatrix({ repos }: EffortMatrixProps) {
  const categorized = repos.map(r => ({
    ...r,
    quadrant: getQuadrant(r.opportunityScore, (r.estimatedEffort ?? 'medium') as EffortLevel),
  }))

  const quadrants = ['Quick Win', 'Invest', 'Fill-In', 'Deprioritize'] as const

  const byQuadrant = Object.fromEntries(
    quadrants.map(q => [q, categorized.filter(r => r.quadrant.name === q)
      .sort((a, b) => b.opportunityScore - a.opportunityScore)])
  ) as Record<string, typeof categorized>

  const hasData = repos.some(r => r.estimatedEffort && r.estimatedEffort !== 'medium')

  return (
    <Card className="card-elevated border-border/60">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Grid2x2 className="w-4 h-4 text-indigo-600" />
          Opportunity vs Effort Matrix
        </CardTitle>
        {!hasData && (
          <p className="text-xs text-muted-foreground">
            Set effort levels on repo detail pages to populate this matrix.
          </p>
        )}
      </CardHeader>
      <CardContent>
        {/* 2×2 grid — top row = high opp, bottom = low opp */}
        <div className="grid grid-cols-2 gap-3">
          {/* Row labels */}
          <div className="col-span-2 grid grid-cols-2 gap-3 text-[10px] text-muted-foreground font-medium uppercase tracking-wide px-1">
            <span>← Low Effort</span>
            <span className="text-right">High Effort →</span>
          </div>

          {['Quick Win', 'Invest', 'Fill-In', 'Deprioritize'].map((qName, i) => {
            const items = byQuadrant[qName] ?? []
            const desc = items[0]?.quadrant.description ?? ''
            const color = items[0]?.quadrant.color ?? 'text-muted-foreground'
            const isHighOpp = i < 2

            return (
              <div key={qName} className={`rounded-lg border p-3 min-h-28 ${QUADRANT_STYLES[qName as keyof typeof QUADRANT_STYLES]}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-xs font-semibold ${color}`}>{qName}</span>
                  <Badge variant="outline" className="text-[10px] h-4 px-1">
                    {isHighOpp ? 'High Opp' : 'Low Opp'}
                  </Badge>
                </div>

                {items.length === 0 ? (
                  <p className="text-[10px] text-muted-foreground">No repos here</p>
                ) : (
                  <ul className="space-y-1">
                    {items.slice(0, 4).map(r => (
                      <li key={r.id}>
                        <Link
                          href={`/repos/${r.id}`}
                          className="text-xs hover:underline flex items-center justify-between gap-1"
                        >
                          <span className="truncate">{r.name}</span>
                          <span className="text-muted-foreground tabular-nums shrink-0">{Math.round(r.opportunityScore)}</span>
                        </Link>
                      </li>
                    ))}
                    {items.length > 4 && (
                      <li className="text-[10px] text-muted-foreground">+{items.length - 4} more</li>
                    )}
                  </ul>
                )}
              </div>
            )
          })}
        </div>

        <p className="text-[10px] text-muted-foreground mt-3 text-center">
          Opportunity score ≥ 50 = High. Set effort on repo detail Overview tab.
        </p>
      </CardContent>
    </Card>
  )
}
