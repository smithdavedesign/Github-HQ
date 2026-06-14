import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Banknote } from 'lucide-react'
import type { getPortfolioCostBreakdown } from '@/lib/actions/repositories'

type CostBreakdown = Awaited<ReturnType<typeof getPortfolioCostBreakdown>>

export function PortfolioCostCard({ breakdown, total }: CostBreakdown) {
  if (total === 0) return null

  return (
    <Card className="card-elevated">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Banknote className="w-4 h-4 text-amber-500" />
          Cost Breakdown
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        {breakdown.map(item => {
          const pct = Math.round((item.amount / total) * 100)
          return (
            <div key={item.label} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{item.label}</span>
                <span className="font-medium tabular-nums">${item.amount.toFixed(0)}/mo</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
                <div className="h-full rounded-full bg-amber-500" style={{ width: `${pct}%` }} />
              </div>
            </div>
          )
        })}
        <div className="flex items-center justify-between text-xs font-semibold pt-2 border-t border-border/40">
          <span>Total</span>
          <span className="tabular-nums">${total.toFixed(0)}/mo</span>
        </div>
      </CardContent>
    </Card>
  )
}
