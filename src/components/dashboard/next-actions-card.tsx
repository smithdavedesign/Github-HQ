import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Compass } from 'lucide-react'
import Link from 'next/link'
import { DECISION_LABEL, type DecisionState, type NextActions } from '@/lib/portfolio/next-actions'

const STATE_STYLE: Record<DecisionState, string> = {
  blocked: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-300 dark:border-red-800',
  build: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
  explore: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
  reconsider: 'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300 dark:border-orange-800',
  maintain: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800',
  archive: 'bg-muted text-muted-foreground',
}

const ORDER: DecisionState[] = ['blocked', 'build', 'explore', 'reconsider', 'maintain', 'archive']

/** "What should I do next?": the few repos that deserve attention, with the reasons. */
export function NextActionsCard({ next }: { next: NextActions }) {
  if (next.activeRepos === 0) return null
  return (
    <Card className="card-elevated">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Compass className="w-4 h-4" />
          {next.attention.length ? `${next.attention.length} of ${next.activeRepos} active repos deserve attention` : 'Nothing needs you today'}
        </CardTitle>
        <div className="flex flex-wrap gap-1.5 pt-1">
          {ORDER.filter(s => next.counts[s] > 0).map(s => (
            <Badge key={s} variant="outline" className={`text-[10px] h-5 px-1.5 ${STATE_STYLE[s]}`}>{next.counts[s]} {DECISION_LABEL[s].toLowerCase()}</Badge>
          ))}
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {next.attention.map((d, i) => (
          <div key={d.repoId} className="flex gap-3">
            <span className="text-xs text-muted-foreground tabular-nums pt-0.5">{i + 1}</span>
            <div className="min-w-0 space-y-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/repos/${d.repoId}`} className="font-medium text-sm hover:underline">{d.name}</Link>
                <Badge variant="outline" className={`text-[10px] h-4 px-1.5 ${STATE_STYLE[d.state]}`}>{DECISION_LABEL[d.state]}</Badge>
              </div>
              <p className="text-sm">{d.nextAction}</p>
              <p className="text-xs text-muted-foreground">Why: {d.reasons.join(' · ')}</p>
            </div>
          </div>
        ))}
        {next.archiveSuggestions.length > 0 && (
          <p className="text-xs text-muted-foreground border-t pt-2">
            {next.archiveSuggestions.length} archive candidate{next.archiveSuggestions.length === 1 ? '' : 's'}:{' '}
            {next.archiveSuggestions.slice(0, 6).map((d, i) => (
              <span key={d.repoId}>{i > 0 && ', '}<Link href={`/repos/${d.repoId}`} className="hover:underline">{d.name}</Link></span>
            ))}
            {next.archiveSuggestions.length > 6 && ', …'}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
