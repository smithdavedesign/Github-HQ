'use client'

import type { ClaudeAnalysis } from '@/lib/ai/analysis'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Sparkles, ShieldCheck, Code2, Wrench, CheckCircle, AlertTriangle, XCircle } from 'lucide-react'
import { formatDistanceToNow } from '@/lib/utils'

interface AnalysisTabProps {
  analysis: ClaudeAnalysis | null
  repoId: number
  analysisAt: Date | null | undefined
}

function RatingBadge({ rating }: { rating: 'Good' | 'Fair' | 'Poor' }) {
  const styles = {
    Good: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
    Fair: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
    Poor: 'bg-red-500/10 text-red-600 border-red-500/20',
  }
  const icons = { Good: CheckCircle, Fair: AlertTriangle, Poor: XCircle }
  const Icon = icons[rating]
  return (
    <Badge variant="outline" className={`gap-1 ${styles[rating]}`}>
      <Icon className="w-3 h-3" /> {rating}
    </Badge>
  )
}

function DebtBadge({ level }: { level: 'Low' | 'Medium' | 'High' }) {
  const styles = {
    Low: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
    Medium: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
    High: 'bg-red-500/10 text-red-600 border-red-500/20',
  }
  return <Badge variant="outline" className={styles[level]}>{level} Tech Debt</Badge>
}

function PriorityDot({ priority }: { priority: 'High' | 'Medium' | 'Low' }) {
  const colors = { High: 'bg-red-500', Medium: 'bg-amber-500', Low: 'bg-slate-400' }
  return <span className={`inline-block w-2 h-2 rounded-full shrink-0 mt-1.5 ${colors[priority]}`} />
}

export function AnalysisTab({ analysis, analysisAt }: AnalysisTabProps) {
  if (!analysis) {
    return (
      <div className="text-center py-10 space-y-2">
        <Sparkles className="w-8 h-8 text-muted-foreground mx-auto" />
        <p className="text-sm font-medium">No analysis yet</p>
        <p className="text-xs text-muted-foreground max-w-sm mx-auto">
          Click <strong>Analyze with Claude</strong> above to run a deep analysis of this repository's architecture, security, code quality, and tech debt.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-sm font-medium">
            <Sparkles className="w-4 h-4 text-violet-500" />
            Claude Analysis
          </div>
          <Badge variant="outline" className="text-lg font-bold px-2.5">
            {analysis.overallScore}/100
          </Badge>
          <Badge variant="secondary" className="text-xs">{analysis.architecture.pattern}</Badge>
        </div>
        {analysisAt && (
          <span className="text-xs text-muted-foreground">
            Last analyzed {formatDistanceToNow(analysisAt)}
          </span>
        )}
      </div>

      {/* Cards grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Architecture */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-1.5">
                <Code2 className="w-4 h-4 text-blue-500" /> Architecture
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">{analysis.architecture.summary}</p>
            {analysis.architecture.strengths.length > 0 && (
              <div>
                <p className="text-xs font-medium text-emerald-600 mb-1">Strengths</p>
                <ul className="space-y-0.5">
                  {analysis.architecture.strengths.map((s, i) => (
                    <li key={i} className="flex gap-2 text-xs">
                      <CheckCircle className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" />
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {analysis.architecture.concerns.length > 0 && (
              <div>
                <p className="text-xs font-medium text-amber-600 mb-1">Concerns</p>
                <ul className="space-y-0.5">
                  {analysis.architecture.concerns.map((c, i) => (
                    <li key={i} className="flex gap-2 text-xs">
                      <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0 mt-0.5" />
                      {c}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Security */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-emerald-500" /> Security
              </CardTitle>
              <RatingBadge rating={analysis.security.rating} />
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">{analysis.security.summary}</p>
            {analysis.security.issues.length > 0 && (
              <div>
                <p className="text-xs font-medium text-red-600 mb-1">Issues</p>
                <ul className="space-y-0.5">
                  {analysis.security.issues.map((issue, i) => (
                    <li key={i} className="flex gap-2 text-xs">
                      <XCircle className="w-3 h-3 text-red-500 shrink-0 mt-0.5" />
                      {issue}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {analysis.security.recommendations.length > 0 && (
              <div>
                <p className="text-xs font-medium text-blue-600 mb-1">Fixes</p>
                <ul className="space-y-0.5">
                  {analysis.security.recommendations.map((r, i) => (
                    <li key={i} className="text-xs text-muted-foreground">→ {r}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Code Quality */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-1.5">
                <Code2 className="w-4 h-4 text-violet-500" /> Code Quality
              </CardTitle>
              <RatingBadge rating={analysis.codeQuality.rating} />
            </div>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">{analysis.codeQuality.summary}</p>
            {analysis.codeQuality.strengths.length > 0 && (
              <div>
                <p className="text-xs font-medium text-emerald-600 mb-1">Strengths</p>
                <ul className="space-y-0.5">
                  {analysis.codeQuality.strengths.map((s, i) => (
                    <li key={i} className="flex gap-2 text-xs">
                      <CheckCircle className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" />
                      {s}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {analysis.codeQuality.improvements.length > 0 && (
              <div>
                <p className="text-xs font-medium text-amber-600 mb-1">Improvements</p>
                <ul className="space-y-0.5">
                  {analysis.codeQuality.improvements.map((imp, i) => (
                    <li key={i} className="text-xs text-muted-foreground">→ {imp}</li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Tech Debt */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-1.5">
                <Wrench className="w-4 h-4 text-orange-500" /> Tech Debt
              </CardTitle>
              <DebtBadge level={analysis.techDebt.level} />
            </div>
          </CardHeader>
          <CardContent className="text-sm">
            {analysis.techDebt.items.length === 0 ? (
              <p className="text-muted-foreground text-xs">No significant tech debt identified.</p>
            ) : (
              <ul className="space-y-1.5">
                {analysis.techDebt.items.map((item, i) => (
                  <li key={i} className="flex gap-2 text-xs">
                    <Wrench className="w-3 h-3 text-orange-400 shrink-0 mt-0.5" />
                    {item}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recommendations */}
      {analysis.recommendations.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Action Plan</CardTitle>
          </CardHeader>
          <CardContent>
            <ol className="space-y-3">
              {analysis.recommendations.map((rec, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <PriorityDot priority={rec.priority} />
                  <div>
                    <p className="font-medium">{rec.action}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{rec.rationale}</p>
                  </div>
                  <Badge
                    variant="outline"
                    className={`ml-auto shrink-0 text-xs h-5 ${
                      rec.priority === 'High' ? 'border-red-400 text-red-600'
                      : rec.priority === 'Medium' ? 'border-amber-400 text-amber-600'
                      : 'border-slate-300 text-slate-500'
                    }`}
                  >
                    {rec.priority}
                  </Badge>
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
