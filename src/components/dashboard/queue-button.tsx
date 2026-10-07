'use client'

import { useState, useEffect, useRef } from 'react'
import { queueAdvisorAction } from '@/lib/actions/agent-queue'
import type { AdvisorAction } from '@/lib/ai/advisor'
import { toast } from 'sonner'
import { Bot, Loader2, CheckCircle, ExternalLink, GitPullRequest, AlertCircle, Clock, FileText, XCircle, ShieldCheck } from 'lucide-react'

type Stage = 'idle' | 'launching' | 'queued' | 'preparing' | 'running' | 'pr_ready' | 'ci_failing' | 'needs_human' | 'awaiting_approval' | 'merged' | 'rejected' | 'report_ready' | 'verified' | 'failed' | 'timed_out'

interface StatusPayload { status: Stage; stage: string; prUrl?: string | null; reason?: string | null; monitorUrl?: string }

const TERMINAL: Stage[] = ['pr_ready', 'ci_failing', 'needs_human', 'awaiting_approval', 'merged', 'rejected', 'report_ready', 'verified', 'failed', 'timed_out']
const POLL_MS  = 10_000
// The factory runs on the owner's Mac, so a request can wait hours for it (asleep, on battery).
// Live polling stops after 15 min; the request itself keeps waiting and shows on the Agents page.
const MAX_POLLS = 90
const AGENTS_PAGE = '/agent-performance'

/** Substantial-effort actions often exceed what the free model tiers can land in one change. */
function isLikelyToLand(action: AdvisorAction): boolean {
  return action.effort !== 'substantial'
}

export function QueueButton({ action }: { action: AdvisorAction }) {
  const [stage, setStage]   = useState<Stage>('idle')
  const [label, setLabel]   = useState('')
  const [prUrl, setPrUrl]   = useState<string | null>(null)
  const [reason, setReason] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const polls = useRef(0)

  // Cleanup on unmount
  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current) }, [])

  // On mount: check if there's already an active task for this repo and hydrate stage.
  // Prevents duplicate queuing when the user navigates away and back mid-run.
  useEffect(() => {
    let cancelled = false
    async function hydrate() {
      try {
        const res = await fetch(`/api/agent-task-status?repoId=${action.repoId}`)
        if (!res.ok || cancelled) return
        const data = await res.json() as StatusPayload & { taskId?: string | null }
        if (cancelled) return
        // Only hydrate if there's a real in-flight state (not idle/unknown)
        if (!data.status || data.status === 'idle') return
        setStage(data.status)
        setLabel(data.stage ?? data.status)
        if (data.prUrl)  setPrUrl(data.prUrl)
        if (data.reason) setReason(data.reason)
        // Resume polling if non-terminal and we have the taskId
        if (data.taskId && !TERMINAL.includes(data.status)) {
          poll(data.taskId)
        }
      } catch { /* non-fatal — button just stays idle */ }
    }
    hydrate()
    return () => { cancelled = true }
  }, [action.repoId])

  function poll(taskId: string) {
    polls.current = 0
    intervalRef.current = setInterval(async () => {
      polls.current++
      if (polls.current > MAX_POLLS) {
        // Not a timeout: the request is still queued for the factory. Stop polling only.
        clearInterval(intervalRef.current!)
        setLabel('Waiting for the factory — see Agents')
        return
      }
      try {
        const res  = await fetch(`/api/agent-task-status?taskId=${taskId}`)
        if (!res.ok) return
        const data = await res.json() as StatusPayload
        setStage(data.status)
        setLabel(data.stage)
        if (data.prUrl)  setPrUrl(data.prUrl)
        setReason(data.reason ?? null)
        if (TERMINAL.includes(data.status)) {
          clearInterval(intervalRef.current!)
          if (data.status === 'pr_ready' && data.prUrl) {
            toast.success('Draft PR opened by the factory', {
              action: { label: 'View PR →', onClick: () => window.open(data.prUrl!, '_blank') },
              duration: 10000,
            })
          } else if (data.status === 'failed') {
            toast.error('Agent request failed', {
              description: `${data.reason ?? 'The factory could not land it.'} The Agents page has the full trace.`,
            })
          } else if (data.status === 'verified') {
            toast.info('Verified — held at stage report', {
              description: 'The change passed the judge. Promote owner-requested to "pr" in factory.config.json to open PRs.',
            })
          }
        }
      } catch { /* non-fatal */ }
    }, POLL_MS)
  }

  async function handleRun() {
    if (!isLikelyToLand(action)) {
      toast.warning('Substantial task', {
        description: 'The factory works at $0 on free models and keeps changes small — this one may not land in one PR.',
      })
    }
    setStage('launching')
    try {
      const result = await queueAdvisorAction(action)
      setStage('queued')
      setLabel('Queued — waiting for the factory')
      poll(result.taskId)
      toast.info('Queued for the factory', { description: 'Follow it on the Agents page; results also appear in Agent History.', duration: 4000 })
    } catch (err) {
      setStage('idle')
      toast.error(err instanceof Error ? err.message : 'Failed to queue the agent')
    }
  }

  // ── Idle / Launching ───────────────────────────────────────────────────────
  if (stage === 'idle' || stage === 'launching') {
    const risky = !isLikelyToLand(action)
    return (
      <button
        onClick={handleRun}
        disabled={stage === 'launching'}
        title={risky ? 'Substantial task — the factory will try it, but it may be too large for one judged change' : 'Queue for the factory (sandboxed, judged, draft PR)'}
        className={`flex items-center gap-1 h-6 px-2 text-[10px] font-medium rounded border transition-colors disabled:opacity-50 ${
          risky
            ? 'border-amber-300 text-amber-600 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400'
            : 'border-indigo-300 text-indigo-600 hover:bg-indigo-50 dark:border-indigo-700 dark:text-indigo-400 dark:hover:bg-indigo-950/40'
        }`}
      >
        {stage === 'launching' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bot className="w-3 h-3" />}
        {stage === 'launching' ? 'Queuing…' : risky ? 'Queue →' : 'Run Agent'}
      </button>
    )
  }

  // ── PR Ready ───────────────────────────────────────────────────────────────
  if (stage === 'pr_ready' && prUrl) {
    return (
      <a href={prUrl} target="_blank" rel="noopener noreferrer"
        className="flex items-center gap-1 text-[10px] font-medium text-emerald-600 hover:text-emerald-700">
        <GitPullRequest className="w-3 h-3" />PR Ready<ExternalLink className="w-2.5 h-2.5" />
      </a>
    )
  }

  // ── Report Ready (report skills: /health, /review, /investigate …) ─────────
  if (stage === 'report_ready') {
    return (
      <a href="#agent-history" onClick={e => { e.preventDefault(); document.getElementById('agent-history')?.scrollIntoView({ behavior: 'smooth' }) }}
        className="flex items-center gap-1 text-[10px] font-medium text-violet-600 hover:text-violet-700 cursor-pointer">
        <FileText className="w-3 h-3" />Report Ready
      </a>
    )
  }

  // ── Verified, held (owner-requested at stage `report`) ─────────────────────
  if (stage === 'verified') {
    return (
      <a href={AGENTS_PAGE} title={reason ?? 'Verified by the judge; no PR at stage report'}
        className="flex items-center gap-1 text-[10px] font-medium text-sky-600 hover:text-sky-700">
        <ShieldCheck className="w-3 h-3" />Verified — held
      </a>
    )
  }

  // ── Merged ─────────────────────────────────────────────────────────────────
  if (stage === 'merged') {
    return (
      <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-600">
        <CheckCircle className="w-3 h-3" />Merged
      </span>
    )
  }

  // ── Rejected (PR closed without merging) ──────────────────────────────────
  if (stage === 'rejected') {
    if (prUrl) {
      return (
        <a href={prUrl} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground">
          <XCircle className="w-3 h-3" />PR closed — not merged<ExternalLink className="w-2.5 h-2.5" />
        </a>
      )
    }
    return (
      <span className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground">
        <XCircle className="w-3 h-3" />PR closed — not merged
      </span>
    )
  }

  // ── CI Failing ─────────────────────────────────────────────────────────────
  if (stage === 'ci_failing') {
    return (
      <a href={prUrl ?? '#'} target={prUrl ? '_blank' : '_self'} rel="noopener noreferrer"
        className="flex items-center gap-1 text-[10px] font-medium text-amber-600 hover:text-amber-700">
        <AlertCircle className="w-3 h-3" />CI failing on the PR
      </a>
    )
  }

  // ── Needs human / awaiting approval ───────────────────────────────────────
  if (stage === 'needs_human' || stage === 'awaiting_approval') {
    return (
      <a href={prUrl ?? '#'} target={prUrl ? '_blank' : '_self'} rel="noopener noreferrer"
        className="flex items-center gap-1 text-[10px] font-medium text-red-500 hover:text-red-600">
        <AlertCircle className="w-3 h-3" />{stage === 'awaiting_approval' ? 'Awaiting approval →' : 'Needs human review →'}
      </a>
    )
  }

  // ── Failed / Timed out ─────────────────────────────────────────────────────
  if (stage === 'failed' || stage === 'timed_out') {
    return (
      <a href={AGENTS_PAGE} title={reason ?? undefined}
        className="flex items-center gap-1 text-[10px] font-medium text-red-500 hover:text-red-600">
        <AlertCircle className="w-3 h-3" />
        {stage === 'failed' ? 'Failed →' : 'Timed out →'}
      </a>
    )
  }

  // ── In-progress ────────────────────────────────────────────────────────────
  const spinning = stage === 'preparing' || stage === 'running'
  return (
    <a href={AGENTS_PAGE} title={reason ?? 'Follow it on the Agents page'}
      className="flex items-center gap-1 text-[10px] font-medium text-indigo-500 hover:text-indigo-600">
      {spinning
        ? <Loader2 className="w-3 h-3 animate-spin" />
        : <Clock className="w-3 h-3" />}
      {label || stage}
    </a>
  )
}
