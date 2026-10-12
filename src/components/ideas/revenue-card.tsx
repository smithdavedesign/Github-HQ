import { CheckCircle2, Circle, CircleDollarSign } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { LaunchChecklist } from '@/lib/ideas/idea-utils'
import { cn } from '@/lib/utils'

const OWNER: Record<'agent' | 'david', string> = { agent: 'agents', david: 'you' }

/**
 * The road from M1 to the first dollar (idea-factory lib/revenue.js, refreshed every pipeline tick):
 * the plan's buyer and price, the next step and whose it is, then every step with how we know.
 */
export function RevenueCard({ launch, hasRepo }: { launch: LaunchChecklist | undefined; hasRepo: boolean }) {
  return (
    <Card data-testid="revenue-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-1.5"><CircleDollarSign className="h-4 w-4 text-emerald-600" />Road to revenue</CardTitle>
      </CardHeader>
      <CardContent className="text-sm space-y-2.5">
        {!launch ? (
          <p className="text-xs text-muted-foreground">
            {hasRepo
              ? 'Starts once M1 is merged: the pipeline writes the revenue plan (who pays, the price, what must exist before charging) and tracks every step to the first dollar.'
              : 'Starts once the idea has a repo and its M1 is merged.'}
          </p>
        ) : (
          <>
            <div className="space-y-1">
              <div className="flex justify-between text-xs"><span>{launch.done} of {launch.total} steps to the first dollar</span>{launch.price && <span className="font-medium">{launch.price}</span>}</div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden" role="progressbar" aria-label="Steps to the first dollar" aria-valuemin={0} aria-valuemax={launch.total} aria-valuenow={launch.done}>
                <div className="h-full bg-emerald-500" style={{ width: `${Math.round((launch.done / Math.max(1, launch.total)) * 100)}%` }} />
              </div>
            </div>
            {launch.buyer && <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">Who pays:</span> {launch.buyer}</p>}
            {launch.next ? (
              <p className="text-xs rounded-md bg-primary/5 border border-primary/20 px-2 py-1.5" data-testid="revenue-next">
                <span className="font-medium">Next:</span> {launch.next.label}{' '}
                <Badge variant="outline" className={cn('h-4 px-1 text-[10px]', launch.next.owner === 'david' && 'border-amber-500/50 text-amber-700 dark:text-amber-300')}>{OWNER[launch.next.owner]}</Badge>
              </p>
            ) : (
              <p className="text-xs text-emerald-600 dark:text-emerald-400">Every step is done: it&apos;s making money.</p>
            )}
            <ul className="space-y-1">
              {launch.steps.map(s => (
                <li key={s.id} className="flex items-start gap-1.5 text-xs">
                  {s.done ? <CheckCircle2 className="h-3.5 w-3.5 mt-px shrink-0 text-emerald-600" /> : <Circle className="h-3.5 w-3.5 mt-px shrink-0 text-muted-foreground" />}
                  <span className={cn('min-w-0', s.done && 'text-muted-foreground')}>
                    {s.label} <span className="text-[10px] text-muted-foreground">· {OWNER[s.owner]}</span>
                    {s.evidence && <span className="block text-[11px] text-muted-foreground truncate" title={s.evidence}>{s.evidence}</span>}
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </CardContent>
    </Card>
  )
}
