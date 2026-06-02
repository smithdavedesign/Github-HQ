'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { WeeklyDiff } from '@/lib/actions/weekly-diff'
import {
  TrendingUp, TrendingDown, Rocket, Archive,
  DollarSign, ShieldAlert, CalendarDays, ChevronDown, ChevronUp,
} from 'lucide-react'
import Link from 'next/link'

// Rows visible before the accordion expands
const DEFAULT_VISIBLE = 3

interface Props {
  diff: WeeklyDiff
}

export function WeeklyDiffCard({ diff }: Props) {
  const [expanded, setExpanded] = useState(false)

  if (!diff.hasData) return null

  // Build a flat priority-ordered list
  type Row = { key: string; icon: React.ReactNode; label: string; detail: string; repoId: number; positive?: boolean }
  const rows: Row[] = []

  if (diff.topImprover) rows.push({
    key: 'imp',
    icon: <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />,
    label: diff.topImprover.repoName,
    detail: `Health +${diff.topImprover.delta} pts (${diff.topImprover.oldScore} → ${diff.topImprover.newScore})`,
    repoId: diff.topImprover.repoId,
    positive: true,
  })
  if (diff.topDecliner) rows.push({
    key: 'dec',
    icon: <TrendingDown className="w-3.5 h-3.5 text-red-400" />,
    label: diff.topDecliner.repoName,
    detail: `Health ${diff.topDecliner.delta} pts (${diff.topDecliner.oldScore} → ${diff.topDecliner.newScore})`,
    repoId: diff.topDecliner.repoId,
  })
  for (const a of diff.newCriticalAlerts) rows.push({
    key: `sec-${a.repoId}`,
    icon: <ShieldAlert className="w-3.5 h-3.5 text-red-400" />,
    label: a.repoName, detail: a.title, repoId: a.repoId,
  })
  for (const r of diff.mrrChanges) {
    const grew = r.to >= r.from
    rows.push({
      key: `mrr-${r.repoId}`,
      icon: <DollarSign className="w-3.5 h-3.5 text-emerald-400" />,
      label: r.repoName,
      detail: r.from === 0 ? `First revenue — $${r.to.toFixed(0)}/mo` : `MRR ${grew ? '+' : ''}$${(r.to - r.from).toFixed(0)}/mo`,
      repoId: r.repoId,
      positive: grew,
    })
  }
  for (const r of diff.newRepos) rows.push({
    key: `new-${r.repoId}`,
    icon: <Rocket className="w-3.5 h-3.5 text-indigo-400" />,
    label: r.repoName, detail: 'Added to portfolio', repoId: r.repoId,
  })
  for (const r of diff.archivedRepos) rows.push({
    key: `arc-${r.repoId}`,
    icon: <Archive className="w-3.5 h-3.5 text-slate-400" />,
    label: r.repoName, detail: 'Archived', repoId: r.repoId,
  })

  const visible = expanded ? rows : rows.slice(0, DEFAULT_VISIBLE)
  const hiddenCount = rows.length - DEFAULT_VISIBLE

  return (
    <Card className="card-elevated">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarDays className="w-4 h-4 text-muted-foreground" />
            <CardTitle className="text-sm font-semibold">This Week</CardTitle>
            {rows.length > 0 && (
              <span className="text-[10px] text-muted-foreground tabular-nums">
                {rows.length} change{rows.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <Link href="/feed" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            Feed →
          </Link>
        </div>
      </CardHeader>
      <CardContent className="pt-0 space-y-1.5">
        {visible.map(row => (
          <DiffRow key={row.key} icon={row.icon} label={row.label} detail={row.detail} repoId={row.repoId} positive={row.positive} />
        ))}

        {rows.length === 0 && (
          <p className="text-xs text-muted-foreground">No changes this week.</p>
        )}

        {/* Accordion toggle — only shown when there are hidden rows */}
        {hiddenCount > 0 && (
          <button
            onClick={() => setExpanded(v => !v)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors pt-0.5 w-full"
          >
            {expanded ? (
              <>
                <ChevronUp className="w-3 h-3 shrink-0" />
                Show less
              </>
            ) : (
              <>
                <ChevronDown className="w-3 h-3 shrink-0" />
                {hiddenCount} more change{hiddenCount !== 1 ? 's' : ''}
              </>
            )}
          </button>
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
