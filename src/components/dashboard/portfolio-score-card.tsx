import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { PortfolioScoreBreakdown } from '@/lib/health/portfolio-score'
import { portfolioGrade } from '@/lib/health/portfolio-score'

import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

const SCORE_COLOR = (s: number) =>
  s >= 80 ? '#22c55e' : s >= 60 ? '#f59e0b' : '#ef4444'

function ScoreRing({ score }: { score: number }) {
  const r = 44
  const circ = 2 * Math.PI * r
  const filled = (score / 100) * circ
  const color = SCORE_COLOR(score)

  return (
    <svg width={120} height={120} viewBox="0 0 120 120" className="shrink-0">
      <circle cx={60} cy={60} r={r} fill="none" stroke="currentColor" strokeWidth={8} className="text-muted/30" />
      <circle
        cx={60} cy={60} r={r} fill="none"
        stroke={color} strokeWidth={8}
        strokeDasharray={`${filled} ${circ - filled}`}
        strokeLinecap="round"
        transform="rotate(-90 60 60)"
        style={{ transition: 'stroke-dasharray 0.6s ease' }}
      />
      <text x={60} y={56} textAnchor="middle" dominantBaseline="middle" fontSize={26} fontWeight="700" fill={color}>
        {score}
      </text>
      <text x={60} y={74} textAnchor="middle" dominantBaseline="middle" fontSize={10} fill="currentColor" className="fill-muted-foreground">
        / 100
      </text>
    </svg>
  )
}

function ComponentBar({ label, value }: { label: string; value: number }) {
  const color = SCORE_COLOR(value)
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${value}%`, backgroundColor: color }}
        />
      </div>
    </div>
  )
}

interface Props {
  breakdown: PortfolioScoreBreakdown
  weekDelta: number | null
}

export function PortfolioScoreCard({ breakdown, weekDelta }: Props) {
  const { grade, label } = portfolioGrade(breakdown.score)

  const deltaIcon = weekDelta == null ? null
    : weekDelta > 0 ? <TrendingUp className="w-3 h-3" />
    : weekDelta < 0 ? <TrendingDown className="w-3 h-3" />
    : <Minus className="w-3 h-3" />

  const deltaColor = weekDelta == null ? '' : weekDelta > 0 ? 'text-emerald-500' : weekDelta < 0 ? 'text-red-400' : 'text-muted-foreground'

  return (
    <Card className="card-elevated">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">Portfolio Score</CardTitle>
          {weekDelta != null && (
            <div className={`flex items-center gap-1 text-xs font-medium ${deltaColor}`}>
              {deltaIcon}
              <span>{weekDelta > 0 ? '+' : ''}{weekDelta} this week</span>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="flex items-center gap-6">
          <ScoreRing score={breakdown.score} />
          <div className="flex-1 space-y-1">
            <div className="mb-3">
              <span className="text-2xl font-bold" style={{ color: SCORE_COLOR(breakdown.score) }}>{grade}</span>
              <span className="text-sm text-muted-foreground ml-2">{label}</span>
            </div>
            <ComponentBar label="Health" value={breakdown.avgHealth} />
            <ComponentBar label="Activity" value={breakdown.activityRatio} />
            <ComponentBar label="Revenue" value={breakdown.revenueScore} />
            <ComponentBar label="Diversity" value={breakdown.diversityScore} />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
