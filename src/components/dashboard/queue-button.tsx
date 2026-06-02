'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { queueAdvisorAction } from '@/lib/actions/nexus'
import type { AdvisorAction } from '@/lib/ai/advisor'
import { toast } from 'sonner'
import { Bot, Loader2, CheckCircle, ExternalLink, GitPullRequest } from 'lucide-react'

interface Props {
  action: AdvisorAction
}

type FlowState = 'idle' | 'queuing' | 'running' | 'pr_ready' | 'error'

export function QueueButton({ action }: Props) {
  const [state, setState]       = useState<FlowState>('idle')
  const [prUrl, setPrUrl]       = useState<string | null>(null)
  const [nexusUrl, setNexusUrl] = useState<string | null>(null)

  async function handleRun() {
    setState('queuing')
    try {
      const result = await queueAdvisorAction(action)
      setNexusUrl(result.nexusUrl)
      setState('running')

      toast.success('Agent running — will create a PR automatically', {
        description: 'Check the Agents page for live status',
        duration: 6000,
      })

      // Poll portfolio_events for the PR created event (max 10 min)
      const taskId = result.taskId
      let attempts = 0
      const maxAttempts = 120  // 5s × 120 = 10 min

      const poll = setInterval(async () => {
        attempts++
        if (attempts > maxAttempts) {
          clearInterval(poll)
          return
        }

        try {
          const res = await fetch(`/api/agent-task-status?taskId=${taskId}`)
          if (!res.ok) return
          const data = await res.json() as { prUrl?: string; status?: string }
          if (data.prUrl) {
            setPrUrl(data.prUrl)
            setState('pr_ready')
            clearInterval(poll)
            toast.success('PR created by agent!', {
              action: { label: 'View PR →', onClick: () => window.open(data.prUrl, '_blank') },
            })
          }
        } catch { /* non-fatal poll failure */ }
      }, 5000)

    } catch (err) {
      setState('error')
      toast.error(err instanceof Error ? err.message : 'Agent run failed')
    }
  }

  if (state === 'pr_ready' && prUrl) {
    return (
      <a
        href={prUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1 text-[10px] font-medium text-emerald-600 hover:text-emerald-700 transition-colors"
      >
        <GitPullRequest className="w-3 h-3" />
        PR Ready
        <ExternalLink className="w-2.5 h-2.5" />
      </a>
    )
  }

  if (state === 'running') {
    return (
      <span className="flex items-center gap-1 text-[10px] font-medium text-indigo-500">
        <Loader2 className="w-3 h-3 animate-spin" />
        Running…
      </span>
    )
  }

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={handleRun}
      disabled={state === 'queuing'}
      className="h-6 px-2 text-[10px] font-medium gap-1 border-indigo-300 text-indigo-600 hover:bg-indigo-50 dark:border-indigo-700 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
    >
      {state === 'queuing'
        ? <Loader2 className="w-3 h-3 animate-spin" />
        : <Bot className="w-3 h-3" />}
      {state === 'queuing' ? 'Starting…' : state === 'error' ? 'Retry' : 'Run Agent'}
    </Button>
  )
}
