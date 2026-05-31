import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LIFECYCLE_META, LIFECYCLE_STAGES, type LifecycleStage } from '@/lib/lifecycle'
import { Layers } from 'lucide-react'
import Link from 'next/link'

interface LifecycleDistributionProps {
  distribution: Record<string, number>
}

export function LifecycleDistribution({ distribution }: LifecycleDistributionProps) {
  const total = Object.values(distribution).reduce((s, n) => s + n, 0)
  if (total === 0) return null

  const stagesWithCounts = LIFECYCLE_STAGES
    .map(stage => ({ stage, count: distribution[stage] ?? 0 }))
    .filter(s => s.count > 0)
    .sort((a, b) => b.count - a.count)

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Layers className="w-4 h-4 text-muted-foreground" />
            Lifecycle Distribution
          </CardTitle>
          <Link href="/repos" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            Set status →
          </Link>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-3">
          {stagesWithCounts.map(({ stage, count }) => {
            const meta = LIFECYCLE_META[stage as LifecycleStage]
            return (
              <div key={stage} className="flex items-center gap-1.5">
                <span className={`inline-block w-2 h-2 rounded-full ${meta.bg} border`} />
                <span className={`text-sm font-medium ${meta.color}`}>{count}</span>
                <span className="text-xs text-muted-foreground">{meta.label}</span>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
