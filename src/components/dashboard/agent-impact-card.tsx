import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Bot, Factory, GitMerge, ArrowRight } from 'lucide-react'
import Link from 'next/link'

interface AgentImpactCardProps {
  /** Nexus (remote executor) totals from portfolio_events. */
  nexus: { merged: number; queued: number; successRate: number | null; totalScoreGained: number; recentMergeCount: number } | null
  /** Local factory, last 30 days, from agent_jobs. */
  factory: { merged: number; closed: number; prsOpened: number; acceptance: number | null } | null
}

// The two executors are reported separately: blended into one "success rate", Nexus's failures
// (2 merged of 306 queued in the 2026-10 audit) hid the factory's results.
export function AgentImpactCard({ nexus, factory }: AgentImpactCardProps) {
  if (!(nexus && nexus.merged > 0) && !(factory && factory.prsOpened > 0)) return null

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
        {nexus && nexus.queued > 0 && (
          <div className="flex items-center gap-2">
            <GitMerge className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
            <span>
              <span className="font-medium">Nexus:</span>{' '}
              <span className="tabular-nums">{nexus.merged} merged of {nexus.queued} queued</span>
              {nexus.successRate != null && (
                <span className={nexus.successRate >= 50 ? 'text-emerald-600 font-medium' : 'text-amber-600 font-medium'}> ({nexus.successRate}%)</span>
              )}
              {nexus.recentMergeCount > 0 && <span className="text-muted-foreground"> · {nexus.recentMergeCount} this month</span>}
              {nexus.totalScoreGained > 0 && <span className="text-emerald-600"> · +{nexus.totalScoreGained} pts (30d)</span>}
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
