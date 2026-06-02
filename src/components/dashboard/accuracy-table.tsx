import { Badge } from '@/components/ui/badge'
import { Shield, Zap, TrendingUp, Heart, TrendingDown, ArrowUp } from 'lucide-react'
import type { AccuracyStats } from '@/lib/actions/advisor-accuracy'

const IMPACT_ICONS = {
  security:    Shield,
  opportunity: Zap,
  revenue:     TrendingUp,
  health:      Heart,
}

const IMPACT_LABELS: Record<string, string> = {
  security:    'Security fixes',
  opportunity: 'Opportunity',
  revenue:     'Revenue',
  health:      'Health',
}

function SignalBadge({ stats }: { stats: AccuracyStats }) {
  if (!stats.hasSignal) {
    return (
      <Badge variant="outline" className="text-[10px] px-1.5 text-muted-foreground border-border/60">
        Building
      </Badge>
    )
  }
  if (stats.successRate >= 75) {
    return (
      <Badge variant="outline" className="text-[10px] px-1.5 bg-emerald-500/10 text-emerald-600 border-emerald-200">
        Strong
      </Badge>
    )
  }
  if (stats.successRate >= 50) {
    return (
      <Badge variant="outline" className="text-[10px] px-1.5 bg-amber-500/10 text-amber-600 border-amber-200">
        Mixed
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="text-[10px] px-1.5 bg-red-500/10 text-red-600 border-red-200">
      Weak
    </Badge>
  )
}

export function AccuracyTable({ stats }: { stats: AccuracyStats[] }) {
  const hasAnyData = stats.some(s => s.dataPoints > 0)

  if (!hasAnyData) {
    return (
      <p className="text-xs text-muted-foreground py-2">
        No completed agent runs yet. Queue advisor actions to start building accuracy data.
      </p>
    )
  }

  return (
    <div className="rounded-md border border-border/50 overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left font-medium text-muted-foreground px-4 py-2">Type</th>
            <th className="text-left font-medium text-muted-foreground px-3 py-2">Success</th>
            <th className="text-left font-medium text-muted-foreground px-3 py-2">Runs</th>
            <th className="text-left font-medium text-muted-foreground px-3 py-2">Avg Δ</th>
            <th className="text-left font-medium text-muted-foreground px-3 py-2">Signal</th>
          </tr>
        </thead>
        <tbody>
          {stats.map(s => {
            const Icon = IMPACT_ICONS[s.impactType as keyof typeof IMPACT_ICONS] ?? Zap
            const rateColor = !s.hasSignal
              ? 'text-muted-foreground'
              : s.successRate >= 75 ? 'text-emerald-600 font-semibold'
              : s.successRate >= 50 ? 'text-amber-600 font-semibold'
              : 'text-red-600 font-semibold'

            const trend = s.dataPoints > 0 && s.hasSignal
              ? s.timeDecayedRate >= s.successRate + 8 ? <ArrowUp className="w-2.5 h-2.5 text-emerald-500 inline ml-1" />
              : s.timeDecayedRate <= s.successRate - 8 ? <TrendingDown className="w-2.5 h-2.5 text-red-400 inline ml-1" />
              : null

              : null

            return (
              <tr key={s.impactType} className="border-t border-border/40 hover:bg-muted/20 transition-colors">
                <td className="px-4 py-2.5">
                  <span className="flex items-center gap-2">
                    <Icon className="w-3.5 h-3.5 text-muted-foreground" />
                    {IMPACT_LABELS[s.impactType]}
                  </span>
                </td>
                <td className="px-3 py-2.5">
                  {s.dataPoints > 0 ? (
                    <span className={rateColor}>
                      {s.hasSignal ? `${s.successRate}%` : `${s.successRate}%*`}
                      {trend}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-2.5 tabular-nums text-muted-foreground">
                  {s.dataPoints > 0 ? s.dataPoints : '—'}
                </td>
                <td className="px-3 py-2.5 tabular-nums">
                  {s.dataPoints > 0 && s.avgActualDelta !== 0 ? (
                    <span className={s.avgActualDelta > 0 ? 'text-emerald-600' : 'text-red-500'}>
                      {s.avgActualDelta > 0 ? '+' : ''}{s.avgActualDelta} pts
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <SignalBadge stats={s} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {stats.some(s => s.dataPoints > 0 && !s.hasSignal) && (
        <p className="text-[10px] text-muted-foreground px-4 py-2 border-t border-border/40 bg-muted/20">
          * = insufficient data for confident signal. Success rate shown is preliminary.
          ↑↓ = trend vs historical average (last 30 days weighted 2×).
        </p>
      )}
    </div>
  )
}
