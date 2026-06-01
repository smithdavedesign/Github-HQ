import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { WeeklyDiff } from '@/lib/actions/weekly-diff'
import {
  TrendingUp, TrendingDown, Rocket, Archive,
  DollarSign, ShieldAlert, CalendarDays,
} from 'lucide-react'
import Link from 'next/link'

interface Props {
  diff: WeeklyDiff
}

export function WeeklyDiffCard({ diff }: Props) {
  if (!diff.hasData) return null

  return (
    <Card className="card-elevated">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-muted-foreground" />
          <CardTitle className="text-sm font-semibold">This Week</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-3">
        {/* Health movers */}
        {(diff.topImprover || diff.topDecliner) && (
          <div className="space-y-1.5">
            {diff.topImprover && (
              <DiffRow
                icon={<TrendingUp className="w-3.5 h-3.5 text-emerald-500" />}
                label={diff.topImprover.repoName}
                detail={`Health +${diff.topImprover.delta} pts (${diff.topImprover.oldScore} → ${diff.topImprover.newScore})`}
                repoId={diff.topImprover.repoId}
                positive
              />
            )}
            {diff.topDecliner && (
              <DiffRow
                icon={<TrendingDown className="w-3.5 h-3.5 text-red-400" />}
                label={diff.topDecliner.repoName}
                detail={`Health ${diff.topDecliner.delta} pts (${diff.topDecliner.oldScore} → ${diff.topDecliner.newScore})`}
                repoId={diff.topDecliner.repoId}
              />
            )}
          </div>
        )}

        {/* New repos */}
        {diff.newRepos.length > 0 && (
          <div className="space-y-1.5">
            {diff.newRepos.map(r => (
              <DiffRow
                key={r.repoId}
                icon={<Rocket className="w-3.5 h-3.5 text-indigo-400" />}
                label={r.repoName}
                detail="Added to portfolio"
                repoId={r.repoId}
              />
            ))}
          </div>
        )}

        {/* Archived repos */}
        {diff.archivedRepos.length > 0 && (
          <div className="space-y-1.5">
            {diff.archivedRepos.map(r => (
              <DiffRow
                key={r.repoId}
                icon={<Archive className="w-3.5 h-3.5 text-slate-400" />}
                label={r.repoName}
                detail="Archived"
                repoId={r.repoId}
              />
            ))}
          </div>
        )}

        {/* MRR changes */}
        {diff.mrrChanges.length > 0 && (
          <div className="space-y-1.5">
            {diff.mrrChanges.map(r => {
              const grew = r.to >= r.from
              return (
                <DiffRow
                  key={r.repoId}
                  icon={<DollarSign className="w-3.5 h-3.5 text-emerald-400" />}
                  label={r.repoName}
                  detail={r.from === 0
                    ? `First revenue — $${r.to.toFixed(0)}/mo`
                    : `MRR ${grew ? '+' : ''}$${(r.to - r.from).toFixed(0)}/mo ($${r.from} → $${r.to})`}
                  repoId={r.repoId}
                  positive={grew}
                />
              )
            })}
          </div>
        )}

        {/* New security alerts */}
        {diff.newCriticalAlerts.length > 0 && (
          <div className="space-y-1.5">
            {diff.newCriticalAlerts.slice(0, 3).map(a => (
              <DiffRow
                key={a.repoId}
                icon={<ShieldAlert className="w-3.5 h-3.5 text-red-400" />}
                label={a.repoName}
                detail={a.title}
                repoId={a.repoId}
              />
            ))}
            {diff.newCriticalAlerts.length > 3 && (
              <p className="text-xs text-muted-foreground pl-5">
                +{diff.newCriticalAlerts.length - 3} more — <Link href="/security" className="underline hover:text-foreground">view all</Link>
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function DiffRow({
  icon, label, detail, repoId, positive,
}: {
  icon: React.ReactNode
  label: string
  detail: string
  repoId: number
  positive?: boolean
}) {
  return (
    <div className="flex items-start gap-2">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <div className="min-w-0">
        <Link href={`/repos/${repoId}`} className="text-xs font-medium hover:underline truncate block">
          {label}
        </Link>
        <p className="text-xs text-muted-foreground truncate">{detail}</p>
      </div>
    </div>
  )
}
