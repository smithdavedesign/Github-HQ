'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Bot, CheckCircle, Clock, TrendingUp, XCircle, GitPullRequest } from 'lucide-react'
import Link from 'next/link'

interface AgentStats {
  queued: number
  created: number
  merged: number
  failed: number
  successRate: number | null
  totalScoreGained: number
  recentMergeCount: number
}

export function AgentStatsBlock({ stats }: { stats: AgentStats }) {
  if (stats.queued === 0 && stats.merged === 0) return null

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Bot className="w-4 h-4 text-indigo-500" />
            Agent Activity
          </span>
          <Link href="/agent-performance" className="text-xs font-normal text-muted-foreground hover:text-foreground">
            Full report →
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <Stat icon={Clock}       color="text-indigo-500" value={stats.queued}  label="Queued" />
          <Stat icon={GitPullRequest} color="text-blue-500"   value={stats.created} label="PRs opened" />
          <Stat icon={CheckCircle} color="text-emerald-500" value={stats.merged}  label="Merged" />
          <Stat icon={XCircle}     color="text-red-400"     value={stats.failed}  label="Failed" />
        </div>

        {(stats.successRate != null || stats.totalScoreGained > 0) && (
          <div className="flex items-center gap-4 pt-3 border-t border-border/50 text-xs text-muted-foreground flex-wrap">
            {stats.successRate != null && (
              <span className="flex items-center gap-1">
                <TrendingUp className="w-3 h-3" />
                <span className={stats.successRate >= 80 ? 'text-emerald-600 font-medium' : 'text-amber-600 font-medium'}>
                  {stats.successRate}% success rate
                </span>
              </span>
            )}
            {stats.totalScoreGained > 0 && (
              <span className="flex items-center gap-1">
                <span className="text-emerald-600 font-medium">+{stats.totalScoreGained} pts</span>
                <span>gained from agent merges (30d)</span>
              </span>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function Stat({ icon: Icon, color, value, label }: { icon: typeof Clock; color: string; value: number; label: string }) {
  return (
    <div className="text-center p-2 rounded-md bg-muted/30">
      <Icon className={`w-3.5 h-3.5 mx-auto mb-1 ${color}`} />
      <p className="text-lg font-bold tabular-nums">{value}</p>
      <p className="text-[10px] text-muted-foreground">{label}</p>
    </div>
  )
}
