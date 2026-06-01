'use client'

import { useState, useTransition } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { runPortfolioSimulation } from '@/lib/actions/simulation'
import type { SimulationResult, GoalType } from '@/lib/health/simulation'
import { Cpu, TrendingUp, DollarSign, Heart, Clock, ChevronRight } from 'lucide-react'
import Link from 'next/link'

const GOAL_OPTIONS: { value: GoalType; label: string; icon: typeof TrendingUp; description: string }[] = [
  { value: 'max_opportunity', label: 'Max Opportunity', icon: TrendingUp, description: 'Maximize portfolio opportunity score' },
  { value: 'max_revenue',     label: 'Max Revenue',     icon: DollarSign,  description: 'Focus on actions most likely to generate MRR' },
  { value: 'max_health',      label: 'Max Health',      icon: Heart,       description: 'Prioritise security fixes and maintenance' },
]

const ACTION_ICONS: Record<string, typeof TrendingUp> = {
  deploy:   Cpu,
  security: Heart,
  activity: TrendingUp,
  revenue:  DollarSign,
}

interface Props {
  defaultHours: number
}

export function SimulationCard({ defaultHours }: Props) {
  const [hours, setHours] = useState(defaultHours)
  const [goalType, setGoalType] = useState<GoalType>('max_opportunity')
  const [result, setResult] = useState<SimulationResult | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleRun() {
    startTransition(async () => {
      const r = await runPortfolioSimulation(hours, goalType)
      setResult(r)
    })
  }

  return (
    <Card className="card-elevated">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold">Plan My Week</CardTitle>
        <p className="text-xs text-muted-foreground">
          Given your available hours, model the highest-ROI allocation across your portfolio.
        </p>
      </CardHeader>
      <CardContent className="pt-0 space-y-4">
        {/* Controls */}
        <div className="flex flex-wrap gap-3 items-end">
          <div className="space-y-1">
            <label className="text-xs text-muted-foreground font-medium">Available hours</label>
            <div className="flex items-center gap-1.5">
              <button onClick={() => setHours(h => Math.max(1, h - 1))} className="w-7 h-7 rounded border border-border/60 text-sm hover:bg-muted/50 transition-colors">−</button>
              <span className="w-8 text-center text-sm font-medium tabular-nums">{hours}</span>
              <button onClick={() => setHours(h => Math.min(80, h + 1))} className="w-7 h-7 rounded border border-border/60 text-sm hover:bg-muted/50 transition-colors">+</button>
            </div>
          </div>

          <div className="space-y-1 flex-1">
            <label className="text-xs text-muted-foreground font-medium">Goal</label>
            <div className="flex gap-1.5 flex-wrap">
              {GOAL_OPTIONS.map(opt => {
                const Icon = opt.icon
                return (
                  <button
                    key={opt.value}
                    onClick={() => setGoalType(opt.value)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                      goalType === opt.value
                        ? 'bg-indigo-600 text-white border-indigo-600'
                        : 'border-border/60 text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    }`}
                  >
                    <Icon className="w-3 h-3" />
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>

          <Button size="sm" onClick={handleRun} disabled={isPending}>
            {isPending ? 'Simulating…' : 'Run Simulation'}
          </Button>
        </div>

        {/* Results */}
        {result && (
          <div className="space-y-3 pt-1 border-t border-border/40">
            {/* Summary row */}
            <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1">
                <TrendingUp className="w-3.5 h-3.5 text-indigo-400" />
                <span className="font-medium text-foreground">+{result.totalOpportunityDelta}</span> opp pts
              </span>
              {result.totalProjectedMrr > 0 && (
                <span className="flex items-center gap-1">
                  <DollarSign className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="font-medium text-foreground">+${result.totalProjectedMrr}</span>/mo projected
                </span>
              )}
              {result.newPortfolioScore != null && (
                <span className="flex items-center gap-1">
                  <Cpu className="w-3.5 h-3.5 text-amber-400" />
                  Portfolio score → <span className="font-medium text-foreground">{result.newPortfolioScore}</span>
                </span>
              )}
              <span className="flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" />
                {result.remainingHours.toFixed(0)}h unallocated
              </span>
            </div>

            {/* Allocation table */}
            {result.allocations.length > 0 ? (
              <div className="space-y-2">
                {result.allocations.map((a, i) => {
                  const Icon = ACTION_ICONS[a.actionType] ?? TrendingUp
                  return (
                    <div key={a.repoId} className="flex items-start gap-2.5">
                      <span className="text-xs text-muted-foreground font-mono w-4 shrink-0 mt-0.5">{i + 1}.</span>
                      <Icon className="w-3.5 h-3.5 shrink-0 mt-0.5 text-indigo-400" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Link href={`/repos/${a.repoId}`} className="text-xs font-medium hover:underline">{a.repoName}</Link>
                          <span className="text-[10px] text-muted-foreground">~{a.estimatedHours.toFixed(0)}h</span>
                          <span className="text-[10px] text-indigo-400 font-medium">+{Math.round(a.opportunityDelta)} pts</span>
                          {a.projectedMrr > 0 && (
                            <span className="text-[10px] text-emerald-500 font-medium">+${a.projectedMrr}/mo</span>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">{a.action}</p>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No actionable improvements found with {hours}h. Try adding more hours or running a sync.</p>
            )}

            {result.coverageNotes.map(note => (
              <p key={note} className="text-xs text-muted-foreground italic">{note}</p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
