import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Bot, Factory, GitMerge, ArrowRight } from 'lucide-react'
import Link from 'next/link'

interface AgentImpactCardProps {
  /** Requests queued from RepoHQ (Run agent, skills, auto-dispatch), all time, from portfolio_events.
   *  Includes the Nexus-era tasks from before the factory became the only executor (Phase 81). */
  requests: { merged: number; queued: number; successRate: number | null; totalScoreGained: number; recentMergeCount: number } | null
  /** The factory's PRs (sensed work and requests), last 30 days, from agent_jobs. */
  factory: { merged: number; closed: number; prsOpened: number; acceptance: number | null } | null
}

// Reported separately: the request line carries the Nexus-era history (2 merged of 306 queued
// in the 2026-10 audit), which would hide the factory's acceptance if blended into one rate.
export function AgentImpactCard({ requests, factory }: AgentImpactCardProps) {
  if (!(requests && requests.merged > 0) && !(factory && factory.prsOpened > 0)) return null

  return (
    <Card className="card-elevated" data-testid="agent-impact">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Bot className="w-4 h-4 text-indigo-500" />
            Agent Impact
          </span>
          <Link href="/agent-performance" className="text-xs font-normal text-muted-foreground hover:text-foreground flex items-center gap-0.5">
            Details <ArrowRight className="w-3 h-3" />
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-2 text-xs">
        {factory && factory.prsOpened > 0 && (
          <div className="flex items-center gap-2">
            <Factory className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
            <span>
              <span className="font-medium">Factory (30d):</span>{' '}
              <span className="tabular-nums">{factory.merged} merged · {factory.closed} closed · {factory.prsOpened} PRs opened</span>
              {factory.acceptance != null && (
                <span className={factory.acceptance >= 0.5 ? 'text-emerald-600 font-medium' : 'text-amber-600 font-medium'}>
                  {' '}· {Math.round(factory.acceptance * 100)}% accepted
                </span>
              )}
            </span>
          </div>
        )}
        {requests && requests.queued > 0 && (
          <div className="flex items-center gap-2">
            <GitMerge className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
            <span>
              <span className="font-medium">Requests (all time):</span>{' '}
              <span className="tabular-nums">{requests.merged} merged of {requests.queued} queued</span>
              {requests.successRate != null && (
                <span className={requests.successRate >= 50 ? 'text-emerald-600 font-medium' : 'text-amber-600 font-medium'}> ({requests.successRate}%)</span>
              )}
              {requests.recentMergeCount > 0 && <span className="text-muted-foreground"> · {requests.recentMergeCount} this month</span>}
              {requests.totalScoreGained > 0 && <span className="text-emerald-600"> · +{requests.totalScoreGained} pts (30d)</span>}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
