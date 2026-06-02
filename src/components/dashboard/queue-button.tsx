'use client'

import { useState, useEffect, useRef } from 'react'
import { queueAdvisorAction } from '@/lib/actions/nexus'
import type { AdvisorAction } from '@/lib/ai/advisor'
import { toast } from 'sonner'
import { Bot, Loader2, CheckCircle, ExternalLink, GitPullRequest, AlertCircle, Clock } from 'lucide-react'

type Stage = 'idle' | 'launching' | 'queued' | 'preparing' | 'running' | 'pr_ready' | 'merged' | 'failed' | 'timed_out'

interface StatusPayload { status: Stage; stage: string; prUrl?: string; nexusUrl?: string }

const TERMINAL: Stage[] = ['pr_ready', 'merged', 'failed', 'timed_out']
const POLL_MS  = 5000
const MAX_POLLS = 180  // 15 min

function isAutoExecuteSafe(action: AdvisorAction): boolean {
  // Substantial-effort tasks need human review — too risky to auto-execute
  return action.effort !== 'substantial'
}

export function QueueButton({ action }: { action: AdvisorAction }) {
  const [stage, setStage]   = useState<Stage>('idle')
  const [label, setLabel]   = useState('')
  const [prUrl, setPrUrl]   = useState<string | null>(null)
  const [nexusUrl, setNexus] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const polls = useRef(0)

  useEffect(() => () => { if (intervalRef.current) clearInterval(intervalRef.current) }, [])

  function poll(taskId: string) {
    polls.current = 0
    intervalRef.current = setInterval(async () => {
      polls.current++
      if (polls.current > MAX_POLLS) {
        clearInterval(intervalRef.current!)
        setStage('timed_out')
        setLabel('Timed out')
        return
      }
      try {
        const res  = await fetch(`/api/agent-task-status?taskId=${taskId}`)
        if (!res.ok) return
        const data = await res.json() as StatusPayload
        setStage(data.status)
        setLabel(data.stage)
        if (data.nexusUrl) setNexus(data.nexusUrl)
        if (data.prUrl)    setPrUrl(data.prUrl)
        if (TERMINAL.includes(data.status)) {
          clearInterval(intervalRef.current!)
          if (data.status === 'pr_ready' && data.prUrl) {
            toast.success('PR created by agent!', {
              action: { label: 'View PR →', onClick: () => window.open(data.prUrl!, '_blank') },
              duration: 10000,
            })
          } else if (data.status === 'failed') {
            toast.error('Agent failed', {
              description: 'Check the Agents page or Nexus for details',
              action: data.nexusUrl
                ? { label: 'Open Nexus →', onClick: () => window.open(data.nexusUrl!, '_blank') }
                : undefined,
            })
          } else if (data.status === 'timed_out') {
            toast.warning('Agent timed out after 15 min', {
              action: data.nexusUrl
                ? { label: 'Check Nexus →', onClick: () => window.open(data.nexusUrl!, '_blank') }
                : undefined,
            })
          }
        }
      } catch { /* non-fatal */ }
    }, POLL_MS)
  }

  async function handleRun() {
    if (!isAutoExecuteSafe(action)) {
      toast.warning('High-risk task — opening Nexus for manual review', {
        description: 'Substantial-effort tasks need human review before the agent runs.',
      })
      // Still queue it, but without autoExecute so it waits in the review queue
    }
    setStage('launching')
    try {
      const result = await queueAdvisorAction(action)
      setNexus(result.nexusUrl)
      setStage('queued')
      setLabel('Queued')
      poll(result.taskId)
      toast.info('Agent queued', { description: 'Will create a PR automatically', duration: 3000 })
    } catch (err) {
      setStage('idle')
      toast.error(err instanceof Error ? err.message : 'Failed to start agent')
    }
  }

  // ── Idle / Launching ───────────────────────────────────────────────────────
  if (stage === 'idle' || stage === 'launching') {
    const risky = !isAutoExecuteSafe(action)
    return (
      <button
        onClick={handleRun}
        disabled={stage === 'launching'}
        title={risky ? 'Substantial task — will queue for manual Nexus review' : 'Run agent automatically'}
        className={`flex items-center gap-1 h-6 px-2 text-[10px] font-medium rounded border transition-colors disabled:opacity-50 ${
          risky
            ? 'border-amber-300 text-amber-600 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-400'
            : 'border-indigo-300 text-indigo-600 hover:bg-indigo-50 dark:border-indigo-700 dark:text-indigo-400 dark:hover:bg-indigo-950/40'
        }`}
      >
        {stage === 'launching' ? <Loader2 className="w-3 h-3 animate-spin" /> : <Bot className="w-3 h-3" />}
        {stage === 'launching' ? 'Starting…' : risky ? 'Queue →' : 'Run Agent'}
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

  // ── Merged ─────────────────────────────────────────────────────────────────
  if (stage === 'merged') {
    return (
      <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-600">
        <CheckCircle className="w-3 h-3" />Merged
      </span>
    )
  }

  // ── Failed / Timed out ─────────────────────────────────────────────────────
  if (stage === 'failed' || stage === 'timed_out') {
    return (
      <a href={nexusUrl ?? '/agent-performance'} target={nexusUrl ? '_blank' : '_self'}
        rel="noopener noreferrer"
        className="flex items-center gap-1 text-[10px] font-medium text-red-500 hover:text-red-600">
        <AlertCircle className="w-3 h-3" />
        {stage === 'failed' ? 'Failed →' : 'Timed out →'}
      </a>
    )
  }

  // ── In-progress ────────────────────────────────────────────────────────────
  const spinning = stage === 'preparing' || stage === 'running'
  return (
    <span className="flex items-center gap-1 text-[10px] font-medium text-indigo-500">
      {spinning
        ? <Loader2 className="w-3 h-3 animate-spin" />
        : <Clock className="w-3 h-3" />}
      {label || stage}
    </span>
  )
}
