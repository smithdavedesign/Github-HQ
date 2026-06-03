'use client'

import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { QueueButton } from '@/components/dashboard/queue-button'
import { Sparkles, ChevronDown, ChevronUp, CheckCircle2, ArrowRight, Clock } from 'lucide-react'
import Link from 'next/link'
import { formatDistanceToNow } from '@/lib/utils'
import type { AdvisorAction } from '@/lib/ai/advisor'
import type { AccuracyStats } from '@/lib/actions/advisor-accuracy'

const EFFORT_BADGE = {
  quick: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400',
  medium: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400',
  substantial: 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400',
}
const EFFORT_LABEL = { quick: '< 30 min', medium: '1–4 h', substantial: '1+ days' }

const IMPACT_COLOR: Record<string, string> = {
  opportunity: 'text-indigo-600 bg-indigo-50 border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-400',
  security:    'text-red-600 bg-red-50 border-red-200 dark:bg-red-950/50 dark:text-red-400',
  revenue:     'text-emerald-600 bg-emerald-50 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-400',
  health:      'text-amber-600 bg-amber-50 border-amber-200 dark:bg-amber-950/50 dark:text-amber-400',
}

function getAcceptanceCriteria(action: AdvisorAction): string[] {
  const criteria: string[] = []
  if (action.impactType === 'security')    criteria.push('No new security alerts introduced')
  if (action.impactType === 'health')      criteria.push('Health score does not decrease')
  if (action.impactType === 'opportunity') criteria.push('Opportunity score improves or stays the same')
  criteria.push('All existing tests continue to pass')
  return criteria
}

interface RepoAdvisorSectionProps {
  actions: AdvisorAction[]
  nexusEnabled: boolean
  generatedAt?: string
  accuracyStats?: AccuracyStats[]
}

export function RepoAdvisorSection({ actions, nexusEnabled, generatedAt, accuracyStats }: RepoAdvisorSectionProps) {
  const [expandedCards, setExpandedCards] = useState<Set<number>>(new Set())

  function toggleCard(i: number) {
    setExpandedCards(prev => {
      const next = new Set(prev)
      next.has(i) ? next.delete(i) : next.add(i)
      return next
    })
  }

  if (actions.length === 0) {
    return (
      <div className="rounded-lg border border-border/40 bg-muted/10 px-4 py-6 text-center">
        <Sparkles className="w-6 h-6 mx-auto mb-2 text-muted-foreground/40" />
        <p className="text-sm font-medium text-muted-foreground">No advisor recommendations for this repo this cycle</p>
        <p className="text-xs text-muted-foreground mt-1">
          This repo didn't make the top 5 highest-impact actions.{' '}
          <Link href="/" className="underline hover:text-foreground">
            View full advisor on dashboard →
          </Link>
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {/* Section header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="w-3.5 h-3.5 text-indigo-500" />
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            AI Advisor — {actions.length} recommendation{actions.length !== 1 ? 's' : ''}
          </p>
        </div>
        {generatedAt && (
          <span className="text-[10px] text-muted-foreground">
            {formatDistanceToNow(new Date(generatedAt))}
          </span>
        )}
      </div>

      {/* Action cards */}
      {actions.map((action, i) => {
        const isExpanded = expandedCards.has(i)
        const criteria = getAcceptanceCriteria(action)
        const impactColor = IMPACT_COLOR[action.impactType] ?? IMPACT_COLOR.opportunity

        return (
          <div
            key={i}
            className="rounded-lg border border-border/50 bg-muted/10 hover:bg-muted/20 transition-colors"
          >
            {/* Summary row — click to expand */}
            <button
              onClick={() => toggleCard(i)}
              className="flex items-start gap-3 p-3 w-full text-left"
              aria-expanded={isExpanded}
              aria-label={`${isExpanded ? 'Collapse' : 'Expand'} recommendation: ${action.action}`}
            >
              <div className={`w-6 h-6 rounded-md border flex items-center justify-center shrink-0 mt-0.5 text-[10px] font-bold ${impactColor}`}>
                {i + 1}
              </div>

              <div className="flex-1 min-w-0 space-y-0.5">
                <p className="text-sm font-medium leading-snug">{action.action}</p>
                {!isExpanded && (
                  <p className="text-xs text-muted-foreground line-clamp-1">{action.reasoning}</p>
                )}
                <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                  <Badge variant="outline" className={`text-[10px] h-4 px-1.5 font-medium ${EFFORT_BADGE[action.effort as keyof typeof EFFORT_BADGE]}`}>
                    {EFFORT_LABEL[action.effort as keyof typeof EFFORT_LABEL]}
                  </Badge>
                  <span className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400">
                    {action.estimatedImpact}
                  </span>
                </div>
              </div>

              <div className="shrink-0 mt-1 text-muted-foreground">
                {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
              </div>
            </button>

            {/* Expanded detail */}
            {isExpanded && (
              <div className="px-3 pb-3 pt-2 space-y-3 border-t border-border/40 ml-9">
                <p className="text-xs text-muted-foreground leading-relaxed">{action.reasoning}</p>

                <div className="space-y-1.5">
                  <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">Agent will verify</p>
                  <ul className="space-y-1">
                    <li className="flex items-start gap-1.5 text-xs text-muted-foreground">
                      <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" />
                      {action.action}
                    </li>
                    {criteria.map((c, ci) => (
                      <li key={ci} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                        <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" />
                        {c}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  {nexusEnabled && <QueueButton action={action} />}
                  {!nexusEnabled && (
                    <p className="text-[10px] text-muted-foreground">
                      Connect Nexus in Settings to run this automatically
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Collapsed: action buttons */}
            {!isExpanded && (
              <div className="flex items-center gap-2 px-3 pb-3 -mt-1 ml-9">
                {nexusEnabled && <QueueButton action={action} />}
                {!nexusEnabled && (
                  <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5" />
                    Nexus not configured
                  </span>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
