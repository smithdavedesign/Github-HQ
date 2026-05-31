import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { Target, CheckCircle, Clock } from 'lucide-react'
import Link from 'next/link'
import type { Goal } from '@/lib/db/schema'

interface GoalsCardProps {
  goals: Goal[]
}

function getStatus(goal: Goal): 'completed' | 'on_track' | 'behind' {
  if (goal.completedAt) return 'completed'
  if (!goal.deadline) return 'on_track'
  const daysLeft = Math.ceil((new Date(goal.deadline).getTime() - Date.now()) / 86400_000)
  const pct = ((goal.currentValue ?? 0) / (goal.targetValue ?? 1)) * 100
  if (daysLeft < 0) return 'behind'
  // If less than 20% of time remaining but less than 50% progress, "behind"
  if (daysLeft < 7 && pct < 50) return 'behind'
  return 'on_track'
}

function formatValue(value: number, unit: string): string {
  if (unit === '$') return `$${value.toLocaleString()}`
  if (unit === 'score') return `${Math.round(value)}`
  return `${Math.round(value)} ${unit}`.trim()
}

function daysLeft(deadline: string): string {
  const days = Math.ceil((new Date(deadline).getTime() - Date.now()) / 86400_000)
  if (days < 0) return 'Overdue'
  if (days === 0) return 'Due today'
  if (days === 1) return '1 day left'
  return `${days}d left`
}

export function GoalsCard({ goals }: GoalsCardProps) {
  if (goals.length === 0) {
    return (
      <Card className="card-elevated border-border/60">
        <CardContent className="py-8 text-center space-y-2">
          <Target className="w-7 h-7 text-muted-foreground/40 mx-auto" />
          <p className="text-sm font-medium">No goals set</p>
          <p className="text-xs text-muted-foreground">
            <Link href="/settings" className="underline hover:text-foreground">Add a goal in Settings</Link>
            {' '}to track progress toward your targets
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="card-elevated border-border/60">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="w-4 h-4 text-indigo-600" />
            Goals
          </CardTitle>
          <Link href="/settings" className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            Manage →
          </Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {goals.map(goal => {
          const current = goal.currentValue ?? 0
          const target = goal.targetValue ?? 1
          const pct = Math.min(100, Math.round((current / target) * 100))
          const status = getStatus(goal)
          const unit = goal.unit ?? ''

          return (
            <div key={goal.id} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  {status === 'completed' && <CheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0" />}
                  <span className="text-sm font-medium truncate">{goal.name}</span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {goal.deadline && status !== 'completed' && (
                    <span className={`text-[10px] font-medium flex items-center gap-0.5 ${status === 'behind' ? 'text-red-500' : 'text-muted-foreground'}`}>
                      <Clock className="w-3 h-3" />
                      {daysLeft(goal.deadline)}
                    </span>
                  )}
                  {status === 'completed' && (
                    <Badge variant="outline" className="text-[10px] h-4 px-1.5 bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400">
                      Done
                    </Badge>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Progress
                  value={pct}
                  className={`flex-1 h-1.5 ${status === 'completed' ? '[&>div]:bg-emerald-500' : status === 'behind' ? '[&>div]:bg-red-500' : '[&>div]:bg-indigo-500'}`}
                />
                <span className="text-xs text-muted-foreground tabular-nums shrink-0 w-20 text-right">
                  {formatValue(current, unit)} / {formatValue(target, unit)}
                </span>
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
