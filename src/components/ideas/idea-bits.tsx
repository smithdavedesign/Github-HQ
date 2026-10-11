import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  DECISION_LABEL, STAGE_LABEL, scoreTone, type DemandProgress, type IdeaDecisionRow, type IdeaPolicy, type IdeaStage, type ReviewJson,
} from '@/lib/ideas/idea-utils'

const TONE = {
  good: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400',
  mid: 'bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400',
  low: 'bg-red-500/10 text-red-600 border-red-500/20 dark:text-red-400',
  none: 'text-muted-foreground',
}

/** The gstack review's 0–10 score, coloured against the review bar (policy.review.minScore). */
export function ScoreBadge({ score, policy, className }: { score?: number; policy: IdeaPolicy | null; className?: string }) {
  if (score === undefined) return <Badge variant="outline" className={cn(TONE.none, className)}>Not reviewed</Badge>
  return (
    <Badge variant="outline" className={cn('font-mono', TONE[scoreTone(score, policy)], className)} title={`Review score; the bar for a demand test is ${policy?.review?.minScore ?? 6}/10`}>
      {Number.isInteger(score) ? score : score.toFixed(1)}/10
    </Badge>
  )
}

const STAGE_TONE: Record<IdeaStage, string> = {
  idea: 'bg-sky-500/10 text-sky-600 border-sky-500/20 dark:text-sky-400',
  validate: 'bg-amber-500/10 text-amber-600 border-amber-500/20 dark:text-amber-400',
  build: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400',
  repo: 'bg-violet-500/10 text-violet-600 border-violet-500/20 dark:text-violet-400',
  building: 'bg-violet-500/10 text-violet-600 border-violet-500/20 dark:text-violet-400',
  live: 'bg-pink-500/10 text-pink-600 border-pink-500/20 dark:text-pink-400',
  pass: 'text-muted-foreground',
}

export function StageBadge({ stage }: { stage: IdeaStage }) {
  return <Badge variant="outline" className={STAGE_TONE[stage]}>{STAGE_LABEL[stage]}</Badge>
}

export function PendingBadge({ decision }: { decision: IdeaDecisionRow }) {
  return (
    <Badge variant="outline" className="border-dashed text-primary" title="The idea pipeline applies it on its next run (every 15 min)">
      {DECISION_LABEL[decision.decision]} queued
    </Badge>
  )
}

function Meter({ label, value, max, display, hint }: { label: string; value: number; max: number; display: string; hint?: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0
  return (
    <div className="space-y-1" title={hint}>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono tabular-nums">{display}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted overflow-hidden" role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className={cn('h-full rounded-full', pct >= 100 ? 'bg-emerald-500' : 'bg-primary')} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

/** Visitors, signups and conversion against the bars the pipeline decides by. */
export function DemandMeters({ d, compact = false }: { d: DemandProgress; compact?: boolean }) {
  const pct = (x: number) => `${Math.round(x * 100)}%`
  return (
    <div className="space-y-2">
      <div className={cn('grid gap-3', compact ? 'grid-cols-3' : 'grid-cols-1 sm:grid-cols-3')}>
        <Meter label="Visitors" value={d.visitors} max={d.minVisitors} display={`${d.visitors}/${d.minVisitors}`} hint={`Unique visitors; the test can judge from ${d.minVisitors}`} />
        <Meter label="Signups" value={d.signups} max={d.target.signups} display={`${d.signups}/${d.target.signups}`} hint={`Waitlist signups; ${d.target.signups} at ${pct(d.target.rate)} builds at the deadline, ${d.early.signups} at ${pct(d.early.rate)} builds early`} />
        <Meter label="Conversion" value={d.rate} max={d.target.rate} display={pct(d.rate)} hint={`Signups per visitor; the bar is ${pct(d.target.rate)}`} />
      </div>
      {!compact && <p className="text-xs text-muted-foreground">{d.status}{d.daysLeft !== null ? ` Decision in ${d.daysLeft} day${d.daysLeft === 1 ? '' : 's'}.` : ''}</p>}
    </div>
  )
}

const QUESTION_LABEL: Record<string, string> = {
  demand: 'Demand reality', statusQuo: 'Status quo', specificity: 'Desperate specificity', wedge: 'Narrowest wedge', futureFit: 'Future fit',
}

/** The review's five forcing questions (gstack /office-hours), each 0–10 with its evidence. */
export function ForcingQuestions({ review }: { review: ReviewJson }) {
  const qs = Object.entries(review.forcingQuestions ?? {})
  if (!qs.length) return null
  return (
    <div className="space-y-2.5">
      {qs.map(([key, q]) => {
        const tone = q.score >= 7 ? 'bg-emerald-500' : q.score >= 4 ? 'bg-amber-500' : 'bg-red-500'
        return (
          <details key={key} className="group">
            <summary className="flex items-center gap-3 cursor-pointer list-none text-sm [&::-webkit-details-marker]:hidden">
              <span className="w-40 shrink-0 text-muted-foreground group-open:text-foreground">{QUESTION_LABEL[key] ?? key}</span>
              <span className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden"><span className={cn('block h-full rounded-full', tone)} style={{ width: `${Math.max(0, Math.min(10, q.score)) * 10}%` }} /></span>
              <span className="w-10 text-right font-mono text-xs tabular-nums">{q.score}/10</span>
            </summary>
            <p className="mt-1.5 ml-0 sm:ml-43 text-xs text-muted-foreground leading-relaxed">{q.evidence}</p>
          </details>
        )
      })}
      <p className="text-xs text-muted-foreground">Click a question for the reviewer’s evidence.</p>
    </div>
  )
}
