import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MetricCardProps {
  title: string
  value: number | string
  icon: LucideIcon
  description?: string
  variant?: 'default' | 'success' | 'warning' | 'danger'
}

const variantClasses = {
  default: 'text-foreground',
  success: 'text-emerald-500',
  warning: 'text-amber-500',
  danger: 'text-red-500',
}

export function MetricCard({ title, value, icon: Icon, description, variant = 'default' }: MetricCardProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <Icon className={cn('w-4 h-4', variantClasses[variant])} />
      </CardHeader>
      <CardContent>
        <div className={cn('text-2xl font-bold', variantClasses[variant])}>{value}</div>
        {description && <p className="text-xs text-muted-foreground mt-1">{description}</p>}
      </CardContent>
    </Card>
  )
}
