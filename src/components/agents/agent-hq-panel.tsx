'use client'

import { useState, useTransition } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  Activity, AlertTriangle, BatteryLow, CalendarClock, ChevronDown, ChevronRight, Container, ExternalLink, Pause,
  Play, PauseCircle, RotateCcw, Server, XCircle, Loader2, ListOrdered,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDistanceToNow } from '@/lib/utils'
import { requestStatusLabel } from '@/lib/agents/factory-request-utils'
import type { AgentHqOverview, RequestRow, RunRow } from '@/lib/agents/agent-hq-data'
import { cancelRequest, retryRequest, runNow, setQueuePaused } from '@/lib/actions/automation'
import { TraceView } from './trace-view'
import { fmtDuration, fmtIn, runKindLabel } from './format'

const POLL_MS = 15_000
/** The worker refreshes its status every minute; older than this and it's considered offline. */
const OFFLINE_AFTER_MS = 3 * 60_000

const REQUEST_STATUS_STYLE: Record<string, string> = {
  queued:    'bg-slate-50 text-slate-600 border-slate-200 dark:bg-slate-900/40 dark:text-slate-300',
  running:   'bg-indigo-50 text-indigo-600 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300',
  pr:        'bg-emerald-50 text-emerald-600 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300',
  verified:  'bg-sky-50 text-sky-600 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300',
  reported:  'bg-violet-50 text-violet-600 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300',
  rejected:  'bg-orange-50 text-orange-600 border-orange-200 dark:bg-orange-950/40 dark:text-orange-300',
  failed:    'bg-red-50 text-red-600 border-red-200 dark:bg-red-950/40 dark:text-red-300',
  cancelled: 'bg-muted text-muted-foreground border-border/60',
}

const RUN_STATUS_STYLE: Record<string, string> = {
  running: 'text-indigo-600',
  ok:      'text-emerald-600',
  skipped: 'text-amber-600',
  failed:  'text-red-500',
}

/**
 * The Agents page's live panel (roadmap Phase 81, docs/agent-hq-migration-prd.md §9): the factory
 * worker and its BullMQ queue, the schedules that replaced the launchd calendar, every automated
 * run (factory jobs and the Vercel crons) and every request with its step-by-step trace.
 */
export function AgentHqPanel({ initial }: { initial: AgentHqOverview }) {
  const { data, refetch } = useQuery<AgentHqOverview>({
    queryKey: ['agent-hq'],
    queryFn: async () => {
      const res = await fetch('/api/agent-hq')
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText)
      return res.json()
    },
    initialData: initial,
    refetchInterval: POLL_MS,
    staleTime: 0,
  })

  return (
    <div className="space-y-6" data-testid="agent-hq">
      <Automation data={data} onChanged={() => void refetch()} />
      <Requests requests={data.requests} onChanged={() => void refetch()} />
    </div>
  )
}

// ─── Automation: worker, queue, schedules, recent runs ─────────────────────────

function Automation({ data, onChanged }: { data: AgentHqOverview; onChanged: () => void }) {
  const [pending, start] = useTransition()
  const worker = data.worker
  // Relative to when the server read it, so render stays pure (the panel refetches every 15 s).
  const snapshotAt = new Date(data.generatedAt).getTime()
  const online = !!worker && snapshotAt - new Date(worker.lastSeenAt).getTime() < OFFLINE_AFTER_MS
  const queue = data.queue

  function act(label: string, fn: () => Promise<unknown>) {
    start(async () => {
      try {
        await fn()
        toast.success(label)
        onChanged()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      }
    })
  }

  return (
    <section className="space-y-3" data-testid="automation">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <Activity className="w-3.5 h-3.5 text-indigo-500" />
          Automation
        </h2>
        <div className="flex items-center gap-1.5 flex-wrap">
          {(['cycle', 'report', 'scout'] as const).map(kind => (
            <Button key={kind} size="sm" variant="outline" className="h-7 text-[11px] gap-1" disabled={pending || data.redis !== 'connected'}
              title={data.redis !== 'connected' ? 'Needs the queue (REDIS_URL)' : `Queue a ${kind} now (requests still go first)`}
              onClick={() => act(`${kind} queued`, () => runNow(kind))}>
              <Play className="w-3 h-3" />Run {kind}
            </Button>
          ))}
          {queue && (
            <Button size="sm" variant="outline" className="h-7 text-[11px] gap-1" disabled={pending}
              onClick={() => act(queue.paused ? 'Queue resumed' : 'Queue paused', () => setQueuePaused(!queue.paused))}>
              {queue.paused ? <><Play className="w-3 h-3" />Resume queue</> : <><Pause className="w-3 h-3" />Pause queue</>}
            </Button>
          )}
        </div>
      </div>

      {/* Worker + queue status */}
      <div className="rounded-lg border border-border/50 p-3 space-y-2 text-xs" data-testid="worker-status">
        {data.redis === 'not-configured' && (
          <p className="text-amber-600 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            The queue isn&apos;t configured (REDIS_URL). Requests still wait in the database and the factory picks them up at its next scheduled cycle.
          </p>
        )}
        {data.redis === 'unreachable' && (
          <p className="text-red-500 flex items-start gap-1.5">
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
            The queue didn&apos;t answer ({data.redisError}). Showing what the database knows.
          </p>
        )}
        {data.redis === 'connected' && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`w-2 h-2 rounded-full ${online ? 'bg-emerald-500' : 'bg-red-500'}`} aria-hidden />
            <Server className="w-3.5 h-3.5 text-muted-foreground" />
            {online && worker
              ? <span>Worker online on <span className="font-medium">{worker.host}</span>{worker.version ? <> · <span className="font-mono">{worker.version}</span></> : null} · seen {formatDistanceToNow(worker.lastSeenAt)}</span>
              : <span className="text-red-500">Worker offline — the Mac is asleep, or the worker isn&apos;t running (bash factory/bin/install-launchd.sh)</span>}
            {worker?.pausedFile && <Badge variant="outline" className="text-[10px] h-4 gap-1"><PauseCircle className="w-2.5 h-2.5" />PAUSE file</Badge>}
            {worker?.onAc === false && <Badge variant="outline" className="text-[10px] h-4 gap-1 text-amber-600"><BatteryLow className="w-2.5 h-2.5" />on battery</Badge>}
            {worker?.dockerUp === false && <Badge variant="outline" className="text-[10px] h-4 gap-1 text-red-500"><Container className="w-2.5 h-2.5" />Docker down</Badge>}
            {queue?.paused && <Badge variant="outline" className="text-[10px] h-4">queue paused</Badge>}
          </div>
        )}
        {data.activeJob && (
          <p className="flex items-center gap-1.5 text-indigo-600" data-testid="active-job">
            <Loader2 className="w-3 h-3 animate-spin" />
            Running <span className="font-medium">{data.activeJob.name}</span>
            {data.activeJob.progress?.step && <span className="text-muted-foreground">· {data.activeJob.progress.step}{data.activeJob.progress.detail ? ` — ${data.activeJob.progress.detail}` : ''}</span>}
          </p>
        )}
        {queue && (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 pt-1" data-testid="queue-counts">
            {[
              { label: 'Waiting', value: queue.waiting + queue.prioritized },
              { label: 'Active', value: queue.active },
              { label: 'Delayed', value: queue.delayed },
              { label: 'Failed', value: queue.failed },
              { label: 'Completed', value: queue.completed },
            ].map(c => (
              <div key={c.label} className="rounded-md bg-muted/30 px-2 py-1.5 text-center">
                <div className="text-base font-semibold tabular-nums">{c.value}</div>
                <div className="text-[10px] text-muted-foreground">{c.label}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Schedules */}
      {data.schedulers.length > 0 && (
        <div className="rounded-lg border border-border/50 p-3 text-xs space-y-1" data-testid="schedulers">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
            <CalendarClock className="w-3 h-3" />Schedules
          </p>
          {data.schedulers.map(s => (
            <div key={s.name} className="flex items-center gap-2 flex-wrap">
              <span className="font-medium w-16">{s.name}</span>
              <code className="text-[10px] bg-muted px-1 py-0.5 rounded">{s.pattern ?? '—'}</code>
              <span className="text-muted-foreground">{s.tz ?? ''}</span>
              <span className="ml-auto text-muted-foreground">next {fmtIn(s.next, snapshotAt)}</span>
            </div>
          ))}
        </div>
      )}

      <RecentRuns runs={data.runs} />
    </section>
  )
}

function RecentRuns({ runs }: { runs: RunRow[] }) {
  const [open, setOpen] = useState<string | null>(null)
  if (runs.length === 0) {
    return <p className="text-xs text-muted-foreground">No automated runs recorded yet — they appear here once the worker or a cron runs.</p>
  }
  return (
    <div className="space-y-1" data-testid="recent-runs">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
        <ListOrdered className="w-3 h-3" />Recent runs
      </p>
      <div className="rounded-lg border border-border/50 divide-y divide-border/40">
        {runs.map(r => {
          const reason = typeof r.summary?.reason === 'string' ? r.summary.reason : r.error
          const isOpen = open === r.id
          const traced = r.kind.startsWith('factory-')
          return (
            <div key={r.id} className="text-xs">
              <button className="w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/20 disabled:cursor-default"
                onClick={() => setOpen(isOpen ? null : r.id)} disabled={!traced} aria-expanded={isOpen}>
                {traced ? (isOpen ? <ChevronDown className="w-3 h-3 shrink-0" /> : <ChevronRight className="w-3 h-3 shrink-0" />) : <span className="w-3" />}
                <span className="font-medium w-32 shrink-0 truncate">{runKindLabel(r.kind)}</span>
                <span className={`w-16 shrink-0 ${RUN_STATUS_STYLE[r.status] ?? ''}`}>{r.status}</span>
                <span className="text-muted-foreground w-16 shrink-0">{r.trigger}</span>
                <span className="flex-1 min-w-0 truncate text-muted-foreground">{reason ?? ''}</span>
                <span className="tabular-nums text-muted-foreground shrink-0">{r.durationMs != null ? fmtDuration(r.durationMs) : r.status === 'running' ? '…' : ''}</span>
                <span className="text-muted-foreground shrink-0 w-16 text-right">{formatDistanceToNow(r.startedAt)}</span>
              </button>
              {isOpen && (
                <div className="px-3 pb-3 pt-1 border-t border-border/30">
                  <TraceView runId={r.id} live={r.status === 'running'} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ─── Requests ──────────────────────────────────────────────────────────────────

function Requests({ requests, onChanged }: { requests: RequestRow[]; onChanged: () => void }) {
  const [open, setOpen] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function act(label: string, fn: () => Promise<unknown>) {
    start(async () => {
      try {
        await fn()
        toast.success(label)
        onChanged()
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err))
      }
    })
  }

  return (
    <section className="space-y-2" data-testid="requests">
      <h2 className="text-sm font-semibold">Requests</h2>
      {requests.length === 0 ? (
        <p className="text-xs text-muted-foreground">No requests yet. Run Agent on an advisor action, or a skill on a repo&apos;s Agent tab.</p>
      ) : (
        <div className="rounded-lg border border-border/50 divide-y divide-border/40">
          {requests.map(r => {
            const isOpen = open === r.id
            const openStatus = r.status === 'queued' || r.status === 'running'
            return (
              <div key={r.id} className="text-xs" data-testid="request-row">
                <div className="flex items-start gap-2 px-3 py-2">
                  <button onClick={() => setOpen(isOpen ? null : r.id)} aria-expanded={isOpen} aria-label={`${isOpen ? 'Hide' : 'Show'} trace`} className="mt-0.5">
                    {isOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                  </button>
                  <div className="flex-1 min-w-0 space-y-0.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge variant="outline" className={`text-[10px] h-4 px-1.5 ${REQUEST_STATUS_STYLE[r.status] ?? ''}`} title={requestStatusLabel(r.status)}>{r.status}</Badge>
                      <span className="font-medium">{r.repoName}</span>
                      <span className="text-muted-foreground">{r.skill ? `/${r.skill}` : r.mode}</span>
                      <span className="text-muted-foreground/70">· {r.source}</span>
                      {r.attempts > 1 && <span className="text-muted-foreground/70">· pickup {r.attempts}</span>}
                    </div>
                    <p className="text-muted-foreground line-clamp-1" title={r.objective}>{r.objective}</p>
                    {r.reason && (openStatus || ['failed', 'rejected', 'verified', 'cancelled'].includes(r.status)) && (
                      <p className={openStatus ? 'text-amber-600' : r.status === 'verified' ? 'text-sky-600' : 'text-red-500'}>{r.reason}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {r.prUrl && (
                      <a href={r.prUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-emerald-600 hover:underline">
                        PR<ExternalLink className="w-2.5 h-2.5" />
                      </a>
                    )}
                    {r.status === 'queued' && (
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px] gap-1" disabled={pending}
                        onClick={() => act('Request cancelled', () => cancelRequest(r.id))}>
                        <XCircle className="w-3 h-3" />Cancel
                      </Button>
                    )}
                    {['failed', 'rejected', 'cancelled'].includes(r.status) && (
                      <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px] gap-1" disabled={pending}
                        onClick={() => act('Queued again', () => retryRequest(r.id))}>
                        <RotateCcw className="w-3 h-3" />Retry
                      </Button>
                    )}
                    <span className="text-muted-foreground w-14 text-right">{formatDistanceToNow(r.createdAt)}</span>
                  </div>
                </div>
                {isOpen && (
                  <div className="px-3 pb-3 pl-8 space-y-2 border-t border-border/30 pt-2">
                    <p className="text-[11px] whitespace-pre-wrap text-muted-foreground">{r.objective}</p>
                    {r.findings && (
                      <pre className="text-[11px] whitespace-pre-wrap rounded-md bg-muted/30 border border-border/40 p-2 max-h-72 overflow-y-auto">{r.findings}</pre>
                    )}
                    <TraceView requestId={r.id} live={openStatus} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
