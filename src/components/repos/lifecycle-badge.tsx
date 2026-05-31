import { Badge } from '@/components/ui/badge'
import { LIFECYCLE_META, type LifecycleStage } from '@/lib/lifecycle'
import { cn } from '@/lib/utils'

export function LifecycleBadge({ status }: { status: string | null | undefined }) {
  const stage = (status ?? 'maintaining') as LifecycleStage
  const meta = LIFECYCLE_META[stage] ?? LIFECYCLE_META.maintaining

  return (
    <Badge variant="outline" className={cn('text-xs', meta.color, meta.bg)}>
      {meta.label}
    </Badge>
  )
}
