import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TrendingUp, Info } from 'lucide-react'
import { formatValuation } from '@/lib/health/valuation'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface PortfolioValuationProps {
  totalValue: number
  valuedRepos: number
  revenueValue: number
  totalRepos: number
}

export function PortfolioValuation({ totalValue, valuedRepos, revenueValue, totalRepos }: PortfolioValuationProps) {
  if (totalValue === 0) return null

  const signalValue = totalValue - revenueValue
  const hasRevenue = revenueValue > 0

  return (
    <Card className="card-elevated border-border/60 overflow-hidden">
      {/* Subtle gradient header */}
      <div className="h-1 bg-gradient-to-r from-indigo-500 via-violet-500 to-purple-500" />
      <CardHeader className="pb-2 pt-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-indigo-600 flex items-center justify-center">
              <TrendingUp className="w-3.5 h-3.5 text-white" />
            </div>
            Portfolio Valuation
          </CardTitle>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button className="text-muted-foreground hover:text-foreground transition-colors">
                  <Info className="w-3.5 h-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent className="max-w-60 text-xs leading-relaxed">
                Revenue repos: MRR × 36–60× SaaS multiple, adjusted for health and activity.
                Non-revenue repos: signal-based estimate from stars and deployment status.
                These are rough estimates, not financial advice.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </CardHeader>

      <CardContent>
        {/* Hero number */}
        <div className="mb-4">
          <p className="text-3xl font-bold tracking-tight tabular-nums text-foreground">
            {formatValuation(totalValue)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Estimated portfolio value · {valuedRepos} of {totalRepos} repos valued
          </p>
        </div>

        {/* Breakdown */}
        {hasRevenue && (
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/30 p-3 border border-emerald-100 dark:border-emerald-900/50">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">Revenue</p>
              <p className="text-lg font-bold tabular-nums text-emerald-700 dark:text-emerald-400 mt-0.5">
                {formatValuation(revenueValue)}
              </p>
              <p className="text-[10px] text-emerald-600/70 dark:text-emerald-500/70">SaaS multiple method</p>
            </div>
            <div className="rounded-lg bg-muted/50 p-3 border border-border/40">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Signal</p>
              <p className="text-lg font-bold tabular-nums mt-0.5">
                {formatValuation(signalValue)}
              </p>
              <p className="text-[10px] text-muted-foreground">Stars + deployment</p>
            </div>
          </div>
        )}

        {!hasRevenue && (
          <p className="text-xs text-muted-foreground border-t border-border/40 pt-3">
            Add MRR to a revenue-generating repo to unlock SaaS multiple valuations.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
