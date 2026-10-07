'use client'

import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, Circle, Info, Loader2, XCircle, ExternalLink } from 'lucide-react'
import type { TraceView as TraceData, TraceStep, AttemptRow } from '@/lib/agents/agent-hq-data'
import { fmtDuration, fmtTime } from './format'

const STEP_ICON: Record<string, { Icon: typeof Circle; color: string }> = {
  start: { Icon: Circle, color: 'text-indigo-400' },
  ok:    { Icon: CheckCircle2, color: 'text-emerald-500' },
  fail:  { Icon: XCircle, color: 'text-red-500' },
  info:  { Icon: Info, color: 'text-muted-foreground' },
}

/** Step names as the factory traces them (factory/run.ts, factory/lib/trace.ts) → readable labels. */
const STEP_LABEL: Record<string, string> = {
  run: 'Run', request: 'Request', reconcile: 'Reconcile PRs', preflight: 'Preflight', sense: 'Sense repos', queue: 'Queue',
  clone: 'Clone', install: 'Install (sandbox)', checks: 'Baseline checks', tasks: 'Tasks', route: 'Route', attempt: 'Attempt',
  harness: 'Agent run', judge: 'Judge', adversary: 'Adversarial review', pr: 'Draft PR', held: 'Held (stage report)',
  report: 'Report', ladder: 'Ladder', repo: 'Repo',
}

/**
 * The trace of one request (or run): every step the factory recorded, in order, with the tier
 * attempts (agent_jobs) above it. Fetched when the row is opened; refreshed while it's open.
 */
export function TraceView({ requestId, runId, live }: { requestId?: string; runId?: string; live: boolean }) {
  const param = requestId ? `requestId=${encodeURIComponent(requestId)}` : `runId=${encodeURIComponent(runId ?? '')}`
  const { data, error, isLoading } = useQuery<TraceData>({
    queryKey: ['agent-hq-trace', param],
    queryFn: async () => {
      const res = await fetch(`/api/agent-hq/trace?${param}`)
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? res.statusText)
      return res.json()
    },
    refetchInterval: live ? 10_000 : false,
    staleTime: 0,
  })

  if (isLoading) return <p className="text-[11px] text-muted-foreground flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" />Loading trace…</p>
  if (error) return <p className="text-[11px] text-red-500">Trace unavailable: {error instanceof Error ? error.message : String(error)}</p>
  if (!data || (data.steps.length === 0 && data.attempts.length === 0)) {
    return <p className="text-[11px] text-muted-foreground">No steps recorded yet{live ? ' — it shows up here as soon as the worker picks it up.' : '.'}</p>
  }

  return (
    <div className="space-y-3" data-testid="trace-view">
      {data.attempts.length > 0 && <Attempts attempts={data.attempts} />}
      {data.steps.length > 0 && (
        <ol className="space-y-1">
          {data.steps.map(s => <StepRow key={s.id} step={s} />)}
        </ol>
      )}
      {data.runs.length > 1 && (
        <p className="text-[10px] text-muted-foreground">{data.runs.length} runs served this request (deferrals and retries are separate runs).</p>
      )}
    </div>
  )
}

function StepRow({ step }: { step: TraceStep }) {
  const { Icon, color } = STEP_ICON[step.status] ?? STEP_ICON.info
  return (
    <li className="flex items-start gap-2 text-[11px] leading-snug">
      <Icon className={`w-3 h-3 mt-0.5 shrink-0 ${color}`} aria-label={step.status} />
      <span className="w-28 shrink-0 font-medium">{STEP_LABEL[step.step] ?? step.step}</span>
      <span className="flex-1 min-w-0 text-muted-foreground break-words">{step.detail ?? ''}</span>
      <span className="shrink-0 tabular-nums text-muted-foreground/80">{step.durationMs != null ? fmtDuration(step.durationMs) : ''}</span>
      <span className="shrink-0 tabular-nums text-muted-foreground/60 w-14 text-right">{fmtTime(step.at)}</span>
    </li>
  )
}

function Attempts({ attempts }: { attempts: AttemptRow[] }) {
  return (
    <div className="rounded-md border border-border/50 overflow-hidden">
      <table className="w-full text-[11px]">
        <thead className="bg-muted/30 text-muted-foreground">
          <tr>{['Tier', 'Model', 'Outcome', 'Judge / reason', 'Adversary', ''].map(h => <th key={h} className="text-left font-medium px-2 py-1">{h}</th>)}</tr>
        </thead>
        <tbody>
          {attempts.map(a => (
            <tr key={a.id} className="border-t border-border/40 align-top">
              <td className="px-2 py-1 font-medium">{a.tier}</td>
              <td className="px-2 py-1 font-mono text-[10px]">{a.model}</td>
              <td className={`px-2 py-1 ${a.status === 'verified' ? 'text-emerald-600' : a.status === 'failed' ? 'text-red-500' : 'text-muted-foreground'}`}>{a.status}</td>
              <td className="px-2 py-1 text-muted-foreground">{a.reason ?? '—'}</td>
              <td className="px-2 py-1">{a.adversaryVerdict ?? '—'}</td>
              <td className="px-2 py-1">
                {a.prUrl && <a href={a.prUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 underline">PR<ExternalLink className="w-2.5 h-2.5" /></a>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
