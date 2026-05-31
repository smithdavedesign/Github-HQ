import { Card, CardContent } from '@/components/ui/card'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MetricCardProps {
  title: string
  value: number | string
  icon: LucideIcon
  description?: string
  variant?: 'default' | 'success' | 'warning' | 'danger'
}

const variantConfig = {
  default: {
    icon: 'text-muted-foreground bg-muted',
    value: 'text-foreground',
    bar: '',
  },
  success: {
    icon: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950/50 dark:text-emerald-400',
    value: 'text-emerald-700 dark:text-emerald-400',
    bar: 'bg-emerald-500',
  },
  warning: {
    icon: 'text-amber-600 bg-amber-50 dark:bg-amber-950/50 dark:text-amber-400',
    value: 'text-amber-700 dark:text-amber-400',
    bar: 'bg-amber-500',
  },
  danger: {
    icon: 'text-red-600 bg-red-50 dark:bg-red-950/50 dark:text-red-400',
    value: 'text-red-700 dark:text-red-400',
    bar: 'bg-red-500',
  },
}

export function MetricCard({ title, value, icon: Icon, description, variant = 'default' }: MetricCardProps) {
  const config = variantConfig[variant]

  return (
    <Card className="card-elevated border-border/60 overflow-hidden relative">
      {/* Colored top accent bar */}
      {config.bar && (
        <div className={cn('absolute top-0 left-0 right-0 h-0.5', config.bar)} />
      )}
      <CardContent className="p-4 pt-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              {title}
            </p>
            <p className={cn('metric-value', config.value)}>{value}</p>
            {description && (
              <p className="text-xs text-muted-foreground mt-1.5">{description}</p>
            )}
          </div>
          <div className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', config.icon)}>
            <Icon className="w-4 h-4" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
