import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { portfolioEvents } from '@/lib/db/schema'
import { eq, and, inArray, desc } from 'drizzle-orm'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatDistanceToNow } from '@/lib/utils'
import { CheckCircle, XCircle, Clock, TrendingUp, Target, Cpu, ExternalLink, BarChart2 } from 'lucide-react'
import Link from 'next/link'
import { getAccuracyByImpactType, getDowngradedRepos } from '@/lib/actions/advisor-accuracy'
import { AccuracyTable } from '@/components/dashboard/accuracy-table'
import { summarizeFactoryEvents } from '@/lib/agents/factory-stats'

export default async function AgentPerformancePage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const userId = session.user.id

  const [events, accuracyStats, downgradedRepos, factoryEvents] = await Promise.all([
    db.query.portfolioEvents.findMany({
      where: and(
        eq(portfolioEvents.userId, userId),
        inArray(portfolioEvents.eventType, ['agent_task_queued', 'agent_pr_created', 'agent_pr_merged', 'agent_pr_rejected', 'agent_execution_failed']),
      ),
      orderBy: [desc(portfolioEvents.occurredAt)],
      with: { repository: { columns: { name: true } } },
    }),
    getAccuracyByImpactType(userId),
    getDowngradedRepos(userId),
    db.query.portfolioEvents.findMany({
      where: and(eq(portfolioEvents.userId, userId), inArray(portfolioEvents.eventType, ['agent_attempt', 'model_scout_report'])),
      columns: { eventType: true, occurredAt: true, metadata: true },
      orderBy: [desc(portfolioEvents.occurredAt)],
      limit: 500,
    }),
  ])
  const factory = summarizeFactoryEvents(factoryEvents)

  // Compute stats
  const queued  = events.filter(e => e.eventType === 'agent_task_queued').length
  const merged  = events.filter(e => e.eventType === 'agent_pr_merged').length
  const failed  = events.filter(e => e.eventType === 'agent_execution_failed').length
  const prsOpen = events.filter(e => e.eventType === 'agent_pr_created').length

  const successRate = queued > 0 ? Math.round((merged / queued) * 100) : null

  // Accuracy: compare predictedDelta vs actualDelta for merged events
  const mergedWithDeltas = events
    .filter(e => e.eventType === 'agent_pr_merged')
    .map(e => {
      const meta = e.metadata as { predictedDelta?: string; actualDelta?: number; actualDeltaPending?: boolean } | null
      return { meta, occurredAt: e.occurredAt }
    })
    .filter(e => e.meta?.predictedDelta && !e.meta?.actualDeltaPending)

  const accuracyNote = mergedWithDeltas.length < 5
    ? `${mergedWithDeltas.length} of 5 merges needed for accuracy score`
    : null

  // Total cost
  const totalCostUsd = events.reduce((sum, e) => {
    const meta = e.metadata as { costUsd?: number } | null
    return sum + (meta?.costUsd ?? 0)
  }, 0)

  const nexusUrl = process.env.NEXUS_API_URL

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Cpu className="w-6 h-6 text-indigo-500" />
            Agent Performance
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Track advisor accuracy and agent execution outcomes
          </p>
        </div>
        {nexusUrl && (
          <a
            href={`${nexusUrl}/learn/review-queue`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          >
            Open Nexus queue <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Tasks queued"  value={queued}  icon={Clock}       color="text-indigo-500" />
        <StatCard label="PRs merged"    value={merged}  icon={CheckCircle} color="text-emerald-500" />
        <StatCard label="Failed"         value={failed}  icon={XCircle}     color="text-red-400" />
        <StatCard
          label="Success rate"
          value={successRate != null ? `${successRate}%` : '—'}
          icon={TrendingUp}
          color={successRate != null ? (successRate >= 80 ? 'text-emerald-500' : 'text-amber-500') : 'text-muted-foreground'}
        />
      </div>

      {/* Accuracy — only shown once there is data to show */}
      {accuracyStats.some(s => s.dataPoints > 0) ? (
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <BarChart2 className="w-3.5 h-3.5 text-indigo-500" />
              Advisor Accuracy by Action Type
            </h2>
            <p className="text-[10px] text-muted-foreground max-w-xs text-right">
              Did health score improve after each merged PR? Updated when PRs merge and repos resync.
            </p>
          </div>
          <AccuracyTable stats={accuracyStats} />
          {downgradedRepos.length > 0 && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-4 py-3 flex items-start gap-2 text-xs text-amber-600">
              <Target className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                <strong>Low-confidence repos</strong> — the advisor will flag recommendations for these repos as needing extra review due to repeated failures:
                {' '}{downgradedRepos.map(d => `${d.repoName} (${d.impactType})`).join(', ')}
              </span>
            </div>
          )}
        </div>
      ) : merged > 0 ? (
        <div className="rounded-lg border border-border/40 bg-muted/10 px-4 py-4 text-center text-xs text-muted-foreground">
          <Target className="w-5 h-5 mx-auto mb-2 opacity-40" />
          Accuracy data builds up as more PRs merge and repos resync. Check back after a few more merges.
        </div>
      ) : null}

      {/* Autonomous factory (local free-model lane — docs/autonomous-factory.md) */}
      {(factory.totalAttempts > 0 || factory.scout) && (
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-2 flex-wrap">
            <h2 className="text-sm font-semibold flex items-center gap-2">
              <Cpu className="w-3.5 h-3.5 text-emerald-500" />
              Autonomous Factory by Model Tier
            </h2>
            <p className="text-[10px] text-muted-foreground max-w-xs text-right">
              M0 local · M1 free cloud · M2 paid. Verified = passed the repo&apos;s own checks and opened a draft PR.
            </p>
          </div>
          <div className="rounded-lg border border-border/50 overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/30 text-muted-foreground">
                <tr>
                  {['Tier', 'Attempts', 'Verified', 'Merged', 'Closed', 'Cost'].map(h => (
                    <th key={h} className="text-left font-medium px-3 py-2">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {factory.rows.map(r => (
                  <tr key={r.tier} className="border-t border-border/40">
                    <td className="px-3 py-2 font-medium">{r.tier}</td>
                    <td className="px-3 py-2 tabular-nums">{r.attempts}</td>
                    <td className="px-3 py-2 tabular-nums">{r.verified}</td>
                    <td className="px-3 py-2 tabular-nums">{r.merged}</td>
                    <td className="px-3 py-2 tabular-nums">{r.rejected}</td>
                    <td className="px-3 py-2 tabular-nums">${r.costUsd.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            {factory.freeSharePct != null ? <>Free-tier share of verified fixes: <span className="font-medium text-foreground">{factory.freeSharePct}%</span> · </> : null}
            {factory.scout ? <>free-agent: <span className="font-mono">{factory.scout.primary ?? '—'}</span> (scouted {formatDistanceToNow(factory.scout.at)})</> : null}
          </p>
        </div>
      )}

      {/* Cost */}
      {totalCostUsd > 0 && (
        <p className="text-xs text-muted-foreground">
          Total agent cost: <span className="font-medium text-foreground">${totalCostUsd.toFixed(2)}</span>
        </p>
      )}

      {/* Event log */}
      <div className="space-y-2">
        <h2 className="text-sm font-semibold">Activity Log</h2>
        {events.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground text-sm">
            <Cpu className="w-8 h-8 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No agent activity yet</p>
            <p className="text-xs mt-1">Queue an advisor action to get started</p>
            <Link href="/" className="underline text-xs mt-3 inline-block hover:text-foreground">← Back to dashboard</Link>
          </div>
        ) : (
          events.slice(0, 50).map(event => {
            const meta = event.metadata as Record<string, unknown> | null
            const repoName = event.repository?.name ?? (meta?.repoHQRepoName as string) ?? '—'

            const statusColor =
              event.eventType === 'agent_pr_merged'       ? 'bg-emerald-500/10 text-emerald-600 border-emerald-200' :
              event.eventType === 'agent_pr_created'      ? 'bg-blue-500/10 text-blue-600 border-blue-200' :
              event.eventType === 'agent_pr_rejected'     ? 'bg-muted text-muted-foreground border-border/60' :
              event.eventType === 'agent_execution_failed'? 'bg-red-500/10 text-red-600 border-red-200' :
                                                            'bg-muted text-muted-foreground border-border/60'

            const label =
              event.eventType === 'agent_task_queued'      ? 'Queued' :
              event.eventType === 'agent_pr_created'       ? 'PR Created' :
              event.eventType === 'agent_pr_merged'        ? 'Merged' :
              event.eventType === 'agent_pr_rejected'      ? 'Rejected' :
              event.eventType === 'agent_execution_failed' ? 'Failed' : event.eventType

            const prUrl = meta?.prUrl as string | undefined

            return (
              <div key={event.id} className="flex items-start gap-3 p-3 rounded-lg border border-border/50 bg-muted/10 text-sm">
                <Badge variant="outline" className={`text-[10px] px-1.5 shrink-0 mt-0.5 ${statusColor}`}>
                  {label}
                </Badge>
                <div className="flex-1 min-w-0">
                  <p className="font-medium truncate">{event.title}</p>
                  {event.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{event.description}</p>
                  )}
                  <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground flex-wrap">
                    <span>{repoName}</span>
                    {meta?.agentName ? <span>{String(meta.agentName)}</span> : null}
                    {meta?.predictedDelta ? <span>Predicted: {String(meta.predictedDelta)}</span> : null}
                    {meta?.costUsd ? <span>${Number(meta.costUsd).toFixed(4)}</span> : null}
                    {prUrl && (
                      <a href={prUrl} target="_blank" rel="noopener noreferrer" className="underline hover:text-foreground flex items-center gap-0.5">
                        View PR <ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    )}
                  </div>
                </div>
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {formatDistanceToNow(event.occurredAt)}
                </span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

function StatCard({ label, value, icon: Icon, color }: { label: string; value: string | number; icon: typeof Clock; color: string }) {
  return (
    <Card className="card-elevated">
      <CardContent className="pt-4 pb-3 px-4">
        <Icon className={`w-4 h-4 mb-1.5 ${color}`} />
        <p className="text-2xl font-bold tabular-nums">{value}</p>
        <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
      </CardContent>
    </Card>
  )
}
