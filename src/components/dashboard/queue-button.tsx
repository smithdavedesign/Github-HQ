'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { queueAdvisorAction } from '@/lib/actions/nexus'
import type { AdvisorAction } from '@/lib/ai/advisor'
import type { NexusTaskStatus } from '@/lib/actions/nexus'
import { toast } from 'sonner'
import { Send, Loader2, CheckCircle, ExternalLink } from 'lucide-react'

interface Props {
  action: AdvisorAction
}

const STATUS_LABEL: Record<NexusTaskStatus, string> = {
  queued:   'Queued',
  preparing: 'Preparing',
  ready:    'Ready',
  failed:   'Failed',
  unknown:  'Queued',
}

export function QueueButton({ action }: Props) {
  const [state, setState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle')
  const [nexusUrl, setNexusUrl] = useState<string | null>(null)
  const [taskStatus, setTaskStatus] = useState<NexusTaskStatus | null>(null)

  async function handleQueue() {
    setState('loading')
    try {
      const result = await queueAdvisorAction(action)
      setNexusUrl(result.nexusUrl)
      setTaskStatus(result.status)
      setState('done')
      toast.success('Queued in Nexus — review it in the queue', {
        action: { label: 'Open queue →', onClick: () => window.open(result.nexusUrl, '_blank') },
      })
    } catch (err) {
      setState('error')
      toast.error(err instanceof Error ? err.message : 'Failed to queue task')
    }
  }

  if (state === 'done' && nexusUrl) {
    return (
      <a
        href={nexusUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1 text-[10px] font-medium text-emerald-600 hover:text-emerald-700 transition-colors"
      >
        <CheckCircle className="w-3 h-3" />
        {taskStatus ? STATUS_LABEL[taskStatus] : 'Queued'}
        <ExternalLink className="w-2.5 h-2.5" />
      </a>
    )
  }

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={handleQueue}
      disabled={state === 'loading'}
      className="h-6 px-2 text-[10px] font-medium gap-1 border-indigo-300 text-indigo-600 hover:bg-indigo-50 dark:border-indigo-700 dark:text-indigo-400 dark:hover:bg-indigo-950/40"
    >
      {state === 'loading'
        ? <Loader2 className="w-3 h-3 animate-spin" />
        : <Send className="w-3 h-3" />}
      {state === 'loading' ? 'Queuing…' : state === 'error' ? 'Retry' : 'Queue →'}
    </Button>
  )
}
