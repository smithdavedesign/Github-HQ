import { Activity } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { GROWTH_STAGE_LABEL, experimentLine, funnelSummary, nextMissionText, safeUrl, type Funnel, type GrowthExperiment, type GrowthState } from '@/lib/ideas/idea-utils'
import { cn } from '@/lib/utils'

const STATUS_CLASS: Record<GrowthExperiment['status'], string> = {
  proposed: 'border-amber-500/50 text-amber-700 dark:text-amber-300',
  running: 'border-sky-500/50 text-sky-700 dark:text-sky-300',
  measuring: 'border-sky-500/50 text-sky-700 dark:text-sky-300',
  decided: 'border-emerald-500/50 text-emerald-700 dark:text-emerald-300',
  abandoned: 'text-muted-foreground',
}

/**
 * The growth loop on one product (docs/growth-loop-prd.md, idea-factory step 5d): its funnel this week
 * against the last and where visitors came from, then, for a focus product, the stage and bottleneck the
 * loop sees, the next mission, and its experiments, newest first.
 */
export function GrowthCard({ funnel, growth, focus }: { funnel?: Funnel; growth?: GrowthState; focus: boolean }) {
  const experiments = [...(growth?.experiments ?? [])].reverse()
  return (
    <Card data-testid="growth-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-1.5"><Activity className="h-4 w-4 text-sky-600" />Growth</CardTitle>
      </CardHeader>
      <CardContent className="text-sm space-y-2.5">
        {funnel ? (
          <div className="space-y-1">
            <p className="text-xs" data-testid="growth-funnel">{funnelSummary(funnel)}</p>
            {funnel.referrers7d?.length ? <p className="text-[11px] text-muted-foreground">Sources this week: {funnel.referrers7d.map(r => `${r.host} ${r.visitors}`).join(', ')}</p> : null}
            {!funnel.seen?.visit && <p className="text-[11px] text-amber-700 dark:text-amber-300">Old beacon: only home-page views are counted, not activations or Buy clicks.</p>}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">No funnel yet: it starts once the product is deployed or has a visitor.</p>
        )}
        {!focus ? (
          <p className="text-xs text-muted-foreground">Not a focus product, so the growth loop starts no missions here (policy.growth.focus in idea-factory).</p>
        ) : growth?.stage ? (
          <>
            <p className="text-xs"><span className="font-medium">{GROWTH_STAGE_LABEL[growth.stage]}:</span> {growth.bottleneck}</p>
            <p className="text-xs rounded-md bg-primary/5 border border-primary/20 px-2 py-1.5" data-testid="growth-next">
              <span className="font-medium">Next:</span> {nextMissionText(growth.next)}
            </p>
            {experiments.length > 0 && (
              <ul className="space-y-1.5" aria-label="Experiments">
                {experiments.slice(0, 6).map(e => {
                  const pr = safeUrl(e.prUrl)
                  return (
                    <li key={e.id} className="text-xs">
                      <Badge variant="outline" className={cn('h-4 px-1 text-[10px] mr-1', STATUS_CLASS[e.status])}>{e.status}</Badge>
                      {experimentLine(e)}
                      {pr && <> · <a href={pr} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">PR</a></>}
                      <span className="block text-[11px] text-muted-foreground">{e.hypothesis}</span>
                    </li>
                  )
                })}
              </ul>
            )}
          </>
        ) : (
          <p className="text-xs text-muted-foreground">The growth loop looks at it on its next run, within 15 minutes.</p>
        )}
      </CardContent>
    </Card>
  )
}
