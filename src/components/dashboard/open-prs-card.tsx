import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { GitPullRequest, AlertTriangle, ExternalLink } from 'lucide-react'
import { AGING_PR_DAYS, PR_SOURCE_LABEL, prAgeDays, type PrSource } from '@/lib/agents/open-prs'
import { prValueFromLabels } from '@/lib/agents/pr-value'
import type { OpenPrsResult } from '@/lib/github/open-prs-query'

const SOURCE_STYLE: Record<PrSource, string> = {
  factory: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-800',
  dependabot: 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800',
  bot: 'bg-muted text-muted-foreground',
  owner: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800',
  other: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800',
}

/** Every open PR across your repos, oldest first, so none get lost. */
export function OpenPrsCard({ result, now }: { result: OpenPrsResult; now: Date }) {
  if (!result.ok) {
    return (
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold flex items-center gap-2"><GitPullRequest className="w-4 h-4" />Open PRs</CardTitle></CardHeader>
        <CardContent className="pt-0 text-xs text-muted-foreground">Couldn&apos;t list open PRs: {result.reason}</CardContent>
      </Card>
    )
  }
  const { prs, total } = result
  const aging = prs.filter(p => prAgeDays(p, now) >= AGING_PR_DAYS).length

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex flex-wrap items-center gap-2">
          <GitPullRequest className="w-4 h-4" />
          {total === 0 ? 'No open PRs' : `${total} open PR${total === 1 ? '' : 's'} waiting for you`}
          {aging > 0 && (
            <span className="flex items-center gap-1 text-xs font-normal text-amber-600 dark:text-amber-400">
              <AlertTriangle className="w-3 h-3" />{aging} open {AGING_PR_DAYS}+ days
            </span>
          )}
        </CardTitle>
        {prs.some(p => p.source === 'factory') && (
          <p className="text-xs text-muted-foreground">Rate factory PRs when you merge them: add a <code>value:0</code>–<code>value:5</code> label.</p>
        )}
      </CardHeader>
      {prs.length > 0 && (
        <CardContent className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="text-left font-medium px-4 sm:px-6 py-2">PR</th>
                <th className="text-left font-medium px-3 py-2 hidden sm:table-cell">From</th>
                <th className="text-right font-medium px-4 sm:px-6 py-2">Age</th>
              </tr>
            </thead>
            <tbody>
              {prs.map(p => {
                const age = prAgeDays(p, now)
                const value = prValueFromLabels(p.labels)
                return (
                  <tr key={p.url} className="border-b last:border-0 hover:bg-muted/50 transition-colors">
                    <td className="px-4 sm:px-6 py-2 min-w-0">
                      <a href={p.url} target="_blank" rel="noopener noreferrer" className="group block min-w-0">
                        <span className="text-xs text-muted-foreground">{p.repo.split('/')[1] ?? p.repo}#{p.number}</span>
                        <span className="flex items-center gap-1 font-medium group-hover:underline">
                          <span className="truncate">{p.title}</span>
                          <ExternalLink className="w-3 h-3 shrink-0 opacity-50" />
                        </span>
                      </a>
                      <span className="mt-1 flex flex-wrap gap-1 sm:hidden">
                        <Badge variant="outline" className={`text-[10px] h-4 px-1.5 ${SOURCE_STYLE[p.source]}`}>{PR_SOURCE_LABEL[p.source]}</Badge>
                      </span>
                    </td>
                    <td className="px-3 py-2 hidden sm:table-cell">
                      <span className="flex flex-wrap gap-1">
                        <Badge variant="outline" className={`text-[10px] h-4 px-1.5 ${SOURCE_STYLE[p.source]}`}>{PR_SOURCE_LABEL[p.source]}</Badge>
                        {p.isDraft && <Badge variant="outline" className="text-[10px] h-4 px-1.5">draft</Badge>}
                        {value !== null && <Badge variant="outline" className="text-[10px] h-4 px-1.5">value {value}</Badge>}
                      </span>
                    </td>
                    <td className={`px-4 sm:px-6 py-2 text-right text-xs tabular-nums whitespace-nowrap ${age >= AGING_PR_DAYS ? 'text-amber-600 dark:text-amber-400 font-medium' : 'text-muted-foreground'}`}>
                      {age === 0 ? 'today' : `${age}d`}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {total > prs.length && <p className="px-4 sm:px-6 py-2 text-xs text-muted-foreground">…and {total - prs.length} more on GitHub.</p>}
        </CardContent>
      )}
    </Card>
  )
}
