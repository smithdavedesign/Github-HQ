'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sparkles, Loader2, Zap, Shield, TrendingUp, Heart, ArrowRight, Clock } from 'lucide-react'
import type { AdvisorContent, AdvisorAction } from '@/lib/ai/advisor'
import type { TimeAllocationItem } from '@/lib/health/scoring'
import type { AccuracyStats } from '@/lib/actions/advisor-accuracy'
import { MIN_DATA_POINTS } from '@/lib/actions/advisor-accuracy-utils'
import { triggerAdvisor } from '@/lib/actions/repositories'
import { formatDistanceToNow } from '@/lib/utils'
import { QueueButton } from './queue-button'
import Link from 'next/link'
import { toast } from 'sonner'

const IMPACT_ICON = {
  opportunity: Zap,
  security: Shield,
  revenue: TrendingUp,
  health: Heart,
}

const IMPACT_COLOR = {
  opportunity: 'text-indigo-600 bg-indigo-50 border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-400',
  security: 'text-red-600 bg-red-50 border-red-200 dark:bg-red-950/50 dark:text-red-400',
  revenue: 'text-emerald-600 bg-emerald-50 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-400',
  health: 'text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-950/50 dark:text-amber-400',
}

const EFFORT_BADGE = {
  quick: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400',
  medium: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400',
  substantial: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400',
}

const EFFORT_LABEL = { quick: '< 30 min', medium: '1–4 h', substantial: '1+ days' }

interface AdvisorCardProps {
  advisor: AdvisorContent | null
  timeAllocation?: TimeAllocationItem[]
  hoursPerWeek?: number
  nexusEnabled?: boolean
  accuracyStats?: AccuracyStats[]
}

const DEFAULT_VISIBLE = 3

function ConfidenceBadge({ impactType, accuracyStats }: { impactType: string; accuracyStats?: AccuracyStats[] }) {
  if (!accuracyStats) return null
  const stat = accuracyStats.find(s => s.impactType === impactType)
  if (!stat || stat.dataPoints === 0) return null

  if (!stat.hasSignal) {
    return <span className="text-[10px] text-muted-foreground ml-1" title={`${stat.dataPoints} run${stat.dataPoints !== 1 ? 's' : ''} — building signal`}>⚪</span>
  }
  if (stat.successRate >= 75) {
    return <span className="text-[10px] ml-1" title={`${stat.successRate}% success rate (${stat.dataPoints} runs)`}>🟢</span>
  }
  if (stat.successRate >= 50) {
    return <span className="text-[10px] ml-1" title={`${stat.successRate}% success rate (${stat.dataPoints} runs)`}>🟡</span>
  }
  return <span className="text-[10px] ml-1" title={`${stat.successRate}% success rate (${stat.dataPoints} runs) — low confidence`}>🔴</span>
}

export function AdvisorCard({ advisor: initialAdvisor, timeAllocation, hoursPerWeek = 10, nexusEnabled = false, accuracyStats }: AdvisorCardProps) {
  const [advisor, setAdvisor] = useState(initialAdvisor)
  const [generating, setGenerating] = useState(false)
  const [showAll, setShowAll] = useState(false)

  async function handleGenerate() {
    setGenerating(true)
    try {
      await triggerAdvisor()
      toast.success('Advisor is running — refresh in ~30 seconds to see results')
    } catch {
      toast.error('Failed to start advisor')
    } finally {
      setGenerating(false)
    }
  }

  if (!advisor) {
    return (
      <Card className="card-elevated border-border/60">
        <CardContent className="py-8 text-center space-y-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 dark:bg-indigo-950/50 flex items-center justify-center mx-auto">
            <Sparkles className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
          </div>
          <div>
            <p className="text-sm font-semibold">AI Portfolio Advisor</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-xs mx-auto">
              Get a prioritised action plan with quantified opportunity score gains, generated from your actual portfolio data
            </p>
          </div>
          <Button size="sm" onClick={handleGenerate} disabled={generating} className="gap-1.5">
            {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {generating ? 'Generating…' : 'Generate Advisor'}
          </Button>
        </CardContent>
      </Card>
    )
  }

  const generatedDate = new Date(advisor.generatedAt)

  return (
    <Card className="card-elevated border-border/60">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <div className="w-6 h-6 rounded-lg bg-indigo-600 flex items-center justify-center">
              <Sparkles className="w-3.5 h-3.5 text-white" />
            </div>
            AI Portfolio Advisor
          </CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">
              {formatDistanceToNow(generatedDate)}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={handleGenerate}
              disabled={generating}
            >
              {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Regenerate'}
            </Button>
          </div>
        </div>
        {/* Headline */}
        <p className="text-sm font-medium text-foreground mt-1 leading-snug">
          {advisor.headline}
        </p>
      </CardHeader>

      <CardContent className="space-y-2.5">
        {advisor.actions.slice(0, showAll ? 5 : DEFAULT_VISIBLE).map((action, i) => {
          const ImpactIcon = IMPACT_ICON[action.impactType] ?? Zap
          return (
            <div
              key={i}
              className="flex gap-3 p-3 rounded-lg border border-border/50 bg-muted/20 hover:bg-muted/40 transition-colors"
            >
              {/* Icon */}
              <div className={`w-7 h-7 rounded-lg border flex items-center justify-center shrink-0 ${IMPACT_COLOR[action.impactType]}`}>
                <ImpactIcon className="w-3.5 h-3.5" />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0 space-y-1">
                <p className="text-sm font-medium leading-snug">{action.action}</p>
                <p className="text-xs text-muted-foreground line-clamp-1">{action.reasoning}</p>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge variant="outline" className={`text-[10px] h-4 px-1.5 font-medium ${EFFORT_BADGE[action.effort]}`}>
                    {EFFORT_LABEL[action.effort]}
                  </Badge>
                  <span className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400 flex items-center gap-0.5">
                    {action.estimatedImpact}
                    <ConfidenceBadge impactType={action.impactType} accuracyStats={accuracyStats} />
                  </span>
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1.5 shrink-0">
                {nexusEnabled && <QueueButton action={action} />}
                <Link
                  href={`/repos/${action.repoId}`}
                  className="text-muted-foreground hover:text-foreground mt-0.5"
                >
                  <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </div>
          )
        })}

        {/* Expand / collapse toggle */}
        {advisor.actions.length > DEFAULT_VISIBLE && (
          <button
            onClick={() => setShowAll(v => !v)}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors w-full text-left pl-1"
          >
            {showAll
              ? 'Show less ↑'
              : `+${advisor.actions.length - DEFAULT_VISIBLE} more action${advisor.actions.length - DEFAULT_VISIBLE > 1 ? 's' : ''} ↓`}
          </button>
        )}

        {/* Time allocation sub-section */}
        {timeAllocation && timeAllocation.length > 0 && (
          <div className="pt-2 border-t border-border/40 space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              Best use of your next {hoursPerWeek}h
            </p>
            {timeAllocation.slice(0, 3).map((item, i) => (
              <div key={item.repoId} className="flex items-center gap-2 text-xs">
                <span className="text-muted-foreground w-4 shrink-0">{i + 1}.</span>
                <Link href={`/repos/${item.repoId}`} className="font-medium hover:underline flex-1 truncate">{item.repoName}</Link>
                <span className="text-emerald-600 dark:text-emerald-400 font-semibold shrink-0">+${item.projectedValueDelta.toLocaleString()}</span>
              </div>
            ))}
          </div>
        )}

        {/* Footer insight */}
        {advisor.portfolioInsight && (
          <p className="text-xs text-muted-foreground pt-1 border-t border-border/40 leading-relaxed">
            {advisor.portfolioInsight}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
