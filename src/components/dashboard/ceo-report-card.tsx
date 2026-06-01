'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  BarChart3, Loader2, TrendingUp, TrendingDown, Trophy, AlertTriangle,
  Crosshair, RefreshCw, ChevronDown, ChevronUp,
} from 'lucide-react'
import type { CeoReportContent, CeoReportRisk } from '@/lib/ai/ceo-report'
import { triggerCeoReport } from '@/lib/actions/repositories'
import { formatDistanceToNow } from '@/lib/utils'
import Link from 'next/link'
import { toast } from 'sonner'

const URGENCY_STYLE: Record<CeoReportRisk['urgency'], string> = {
  critical: 'bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-400',
  high:     'bg-orange-50 text-orange-700 border-orange-200 dark:bg-orange-950/30 dark:text-orange-400',
  medium:   'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400',
}

interface CeoReportCardProps {
  report: CeoReportContent | null
}

export function CeoReportCard({ report: initialReport }: CeoReportCardProps) {
  const [report, setReport] = useState(initialReport)
  const [generating, setGenerating] = useState(false)
  const [expanded, setExpanded] = useState(false)

  async function handleGenerate() {
    setGenerating(true)
    try {
      await triggerCeoReport()
      toast.success('CEO Report is generating — refresh in ~30 seconds')
    } catch {
      toast.error('Failed to start CEO Report')
    } finally {
      setGenerating(false)
    }
  }

  if (!report) {
    return (
      <Card className="card-elevated border-border/60">
        <CardContent className="py-8 text-center space-y-3">
          <div className="w-10 h-10 rounded-xl bg-violet-50 dark:bg-violet-950/50 flex items-center justify-center mx-auto">
            <BarChart3 className="w-5 h-5 text-violet-600 dark:text-violet-400" />
          </div>
          <div>
            <p className="text-sm font-medium">Weekly CEO Report</p>
            <p className="text-xs text-muted-foreground mt-1">
              Portfolio summary, wins, risks, and recommended focus — every Monday.
            </p>
          </div>
          <Button size="sm" onClick={handleGenerate} disabled={generating} className="gap-2">
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <BarChart3 className="w-4 h-4" />}
            Generate Report
          </Button>
        </CardContent>
      </Card>
    )
  }

  const { portfolioSummary: s, biggestWins, biggestRisks, recommendedFocus, closingLine, generatedAt } = report

  return (
    <Card className="card-elevated border-border/60">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-violet-50 dark:bg-violet-950/50 flex items-center justify-center">
              <BarChart3 className="w-4 h-4 text-violet-600 dark:text-violet-400" />
            </div>
            <div>
              <CardTitle className="text-sm font-semibold">Weekly CEO Report</CardTitle>
              <p className="text-xs text-muted-foreground">
                {formatDistanceToNow(new Date(generatedAt))} ago
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={() => setExpanded(e => !e)}
              title={expanded ? 'Collapse' : 'Expand'}
            >
              {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              onClick={handleGenerate}
              disabled={generating}
              title="Regenerate"
            >
              {generating
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : <RefreshCw className="w-4 h-4" />}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Portfolio summary strip */}
        <div className="grid grid-cols-3 gap-2 p-3 rounded-lg bg-muted/40 border border-border/60">
          <div className="text-center">
            <p className="text-xs text-muted-foreground">Portfolio Value</p>
            <p className="text-sm font-bold tabular-nums">
              ${s.totalValueUsd.toLocaleString()}
            </p>
          </div>
          <div className="text-center border-x border-border/60">
            <p className="text-xs text-muted-foreground">MRR</p>
            <p className="text-sm font-bold tabular-nums">
              ${s.mrr.toFixed(0)}
              {s.mrrDelta !== 0 && (
                <span className={`text-xs ml-1 ${s.mrrDelta > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {s.mrrDelta > 0 ? '+' : ''}{s.mrrDelta.toFixed(0)}
                </span>
              )}
            </p>
          </div>
          <div className="text-center">
            <p className="text-xs text-muted-foreground">Avg Health</p>
            <p className="text-sm font-bold tabular-nums">
              {s.avgHealth}
              {s.avgHealthDelta !== 0 && (
                <span className={`text-xs ml-1 ${s.avgHealthDelta > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {s.avgHealthDelta > 0 ? '+' : ''}{s.avgHealthDelta}
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Closing line (always visible) */}
        <p className="text-sm italic text-muted-foreground border-l-2 border-violet-400 pl-3">
          {closingLine}
        </p>

        {/* Wins + Risks + Focus (expandable) */}
        {expanded && (
          <div className="space-y-4 pt-1">
            {/* Biggest Wins */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                <Trophy className="w-3.5 h-3.5" />
                Biggest Wins
              </div>
              {biggestWins.map((w, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <TrendingUp className="w-3.5 h-3.5 text-emerald-600 mt-0.5 shrink-0" />
                  <span>
                    <strong>{w.repoName}</strong> — {w.achievement}
                  </span>
                </div>
              ))}
            </div>

            {/* Biggest Risks */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-red-700 dark:text-red-400">
                <AlertTriangle className="w-3.5 h-3.5" />
                Biggest Risks
              </div>
              {biggestRisks.map((r, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <TrendingDown className="w-3.5 h-3.5 text-red-600 mt-0.5 shrink-0" />
                  <span>
                    <Link href={`/repos/${r.repoId}`} className="font-semibold hover:underline">
                      {r.repoName}
                    </Link>
                    {' '}— {r.risk}
                  </span>
                  <Badge variant="outline" className={`text-xs shrink-0 ${URGENCY_STYLE[r.urgency]}`}>
                    {r.urgency}
                  </Badge>
                </div>
              ))}
            </div>

            {/* Recommended Focus */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-violet-700 dark:text-violet-400">
                <Crosshair className="w-3.5 h-3.5" />
                Recommended Focus This Week
              </div>
              {recommendedFocus.map(f => (
                <div key={f.rank} className="flex items-start gap-2 text-xs">
                  <span className="w-4 h-4 rounded-full bg-violet-100 dark:bg-violet-950/50 flex items-center justify-center text-violet-700 dark:text-violet-400 shrink-0 font-bold text-[10px] mt-0.5">
                    {f.rank}
                  </span>
                  <span>
                    <Link href={`/repos/${f.repoId}`} className="font-semibold hover:underline">
                      {f.repoName}
                    </Link>
                    {' '}— {f.rationale}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
