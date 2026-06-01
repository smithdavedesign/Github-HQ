import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { TrendInfo } from '@/lib/health/history'
import { HEALTH_THRESHOLD_HEALTHY, HEALTH_THRESHOLD_AT_RISK } from '@/lib/health/scoring'

interface HealthBadgeProps {
  score: number
  showScore?: boolean
  trend?: TrendInfo | null
  className?: string
}

export function HealthBadge({ score, showScore = true, trend, className }: HealthBadgeProps) {
  const color = score >= HEALTH_THRESHOLD_HEALTHY ? 'emerald' : score >= HEALTH_THRESHOLD_AT_RISK ? 'amber' : 'red'

  const colorClasses = {
    emerald: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400',
    amber: 'bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400',
    red: 'bg-red-500/10 text-red-600 border-red-500/20 dark:text-red-400',
  }

  const label = score >= HEALTH_THRESHOLD_HEALTHY ? 'Healthy' : score >= HEALTH_THRESHOLD_AT_RISK ? 'At Risk' : 'Dead'

  const trendSymbol = trend
    ? trend.direction === 'up' ? '↑'
      : trend.direction === 'down' ? '↓'
      : null
    : null

  const trendColor = trend?.direction === 'up'
    ? 'text-emerald-600'
    : trend?.direction === 'down'
      ? 'text-red-500'
      : ''

  return (
    <Badge
      variant="outline"
      className={cn('gap-1.5 font-mono text-xs', colorClasses[color], className)}
      title={trend ? `${trend.direction === 'up' ? '+' : ''}${trend.delta} pts over ${trend.days}d` : undefined}
    >
      <span
        className={cn(
          'inline-block w-1.5 h-1.5 rounded-full',
          color === 'emerald' ? 'bg-emerald-500' : color === 'amber' ? 'bg-amber-500' : 'bg-red-500',
        )}
      />
      {showScore ? `${score}` : label}
      {trendSymbol && (
        <span className={cn('text-xs leading-none', trendColor)}>{trendSymbol}</span>
      )}
    </Badge>
  )
}

export function ActivityBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string }> = {
    'Actively Maintained': { label: 'Active', color: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20' },
    'Low Activity': { label: 'Low', color: 'bg-amber-500/10 text-amber-600 border-amber-500/20' },
    'Dormant': { label: 'Dormant', color: 'bg-slate-500/10 text-slate-600 border-slate-500/20' },
    'Abandoned': { label: 'Abandoned', color: 'bg-red-500/10 text-red-600 border-red-500/20' },
  }
  const style = map[status] ?? map['Dormant']
  return (
    <Badge variant="outline" className={cn('text-xs', style.color)}>
      {style.label}
    </Badge>
  )
}
