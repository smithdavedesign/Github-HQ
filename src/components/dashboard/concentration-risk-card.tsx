import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { ConcentrationRisk } from '@/lib/actions/repositories'
import { AlertTriangle, CheckCircle, ShieldAlert, Layers } from 'lucide-react'
import Link from 'next/link'

const RISK_STYLES = {
  none:   { label: 'No Revenue',  icon: CheckCircle,  color: 'text-muted-foreground', bar: 'bg-muted/40' },
  low:    { label: 'Low',         icon: CheckCircle,  color: 'text-emerald-500',       bar: 'bg-emerald-500' },
  medium: { label: 'Medium',      icon: AlertTriangle, color: 'text-amber-500',        bar: 'bg-amber-500' },
  high:   { label: 'High',        icon: ShieldAlert,   color: 'text-red-500',          bar: 'bg-red-500' },
}

interface Props { risk: ConcentrationRisk }

export function ConcentrationRiskCard({ risk }: Props) {
  const style = RISK_STYLES[risk.revenueRiskLevel]
  const RiskIcon = style.icon

  return (
    <Card className="card-elevated">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">Portfolio Risk</CardTitle>
          <div className={`flex items-center gap-1.5 text-xs font-medium ${style.color}`}>
            <RiskIcon className="w-3.5 h-3.5" />
            {style.label} concentration
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">

        {/* Revenue concentration */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Revenue concentration</span>
            {risk.topRevenueRepo ? (
              <Link href={`/repos/${risk.topRevenueRepo.id}`} className={`font-medium hover:underline ${style.color}`}>
                {risk.topRevenueRepo.name} — {risk.topRevenueRepo.pct}%
              </Link>
            ) : (
              <span className="text-muted-foreground">No revenue repos</span>
            )}
          </div>
          {risk.topRevenueRepo && (
            <>
              <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-500 ${style.bar}`}
                  style={{ width: `${risk.topRevenueRepo.pct}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>{risk.revenueRepoCount} revenue repo{risk.revenueRepoCount !== 1 ? 's' : ''} · ${risk.totalMrr.toFixed(0)}/mo total</span>
                {risk.topRevenueRepo.healthScore > 0 && (
                  <span>Top repo health: {risk.topRevenueRepo.healthScore}</span>
                )}
              </div>
              {risk.revenueRiskLevel === 'high' && (
                <p className="text-xs text-red-500/80">
                  Single-point-of-failure — {risk.topRevenueRepo.pct}% of MRR from one repo.
                  {risk.topRevenueRepo.healthScore < 75 && ' Health is below safe threshold.'}
                </p>
              )}
              {risk.revenueRiskLevel === 'medium' && (
                <p className="text-xs text-amber-500/80">
                  Revenue is moderately concentrated. Consider diversifying across {risk.revenueRepoCount + 1}+ repos.
                </p>
              )}
            </>
          )}
        </div>

        {/* Stack concentration */}
        {risk.dominantStack && (
          <div className="pt-2 border-t border-border/40 flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5 text-muted-foreground">
              <Layers className="w-3.5 h-3.5" />
              <span>Stack concentration</span>
            </div>
            <span className="font-medium">
              {risk.dominantStack.framework} · {risk.dominantStack.count} repos ({risk.dominantStack.pct}%)
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
