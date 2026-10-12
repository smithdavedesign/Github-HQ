'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AlertCircle, Loader2 } from 'lucide-react'
import { getAiRun, triggerAdvisor, triggerCeoReport } from '@/lib/actions/repositories'
import { aiRunLine, type AiRunStatus } from '@/lib/ai/run-status'

const POLL_MS = 4_000
const GIVE_UP_MS = 6 * 60_000
const START = { 'ai:advisor': triggerAdvisor, 'ai:ceo-report': triggerCeoReport } as const
const NAME = { 'ai:advisor': 'Advisor', 'ai:ceo-report': 'CEO report' } as const

/**
 * Run the Advisor or CEO report and follow it to the end: the buttons used to say "refresh in ~30
 * seconds" and nothing more, so a failure (a free tier's daily limit) looked like nothing happening.
 */
export function useAiRun(kind: keyof typeof START, contentAt: Date | null) {
  const router = useRouter()
  const [run, setRun] = useState<AiRunStatus | null>(null)
  const [starting, setStarting] = useState(false)
  const polling = useRef(false)

  const follow = useCallback(async (startedAt: number) => {
    if (polling.current) return
    polling.current = true
    try {
      while (Date.now() - startedAt < GIVE_UP_MS) {
        await new Promise(r => setTimeout(r, POLL_MS))
        const latest = await getAiRun(kind).catch(() => null)
        if (!latest) continue
        setRun(latest)
        if (latest.status === 'ok') { toast.success(`${NAME[kind]} updated`); router.refresh(); return }
        if (latest.status === 'failed') { toast.error(`${NAME[kind]} failed: ${latest.error ?? 'see the card'}`); return }
      }
    } finally {
      polling.current = false
    }
  }, [kind, router])

  // The last run's state on load; a run still going is followed to the end.
  useEffect(() => {
    let live = true
    getAiRun(kind).then(r => {
      if (!live || !r) return
      setRun(r)
      if (r.status === 'running') void follow(new Date(r.startedAt).getTime())
    }).catch(() => {})
    return () => { live = false }
  }, [kind, follow])

  const start = useCallback(async () => {
    setStarting(true)
    try {
      await START[kind]()
      setRun({ id: 'pending', status: 'running', error: null, startedAt: new Date(), finishedAt: null })
      void follow(Date.now())
    } catch (err) {
      toast.error(`Couldn't start the ${NAME[kind]}: ${err instanceof Error ? err.message : 'unknown error'}`)
    } finally {
      setStarting(false)
    }
  }, [kind, follow])

  const line = aiRunLine(run && { ...run, startedAt: new Date(run.startedAt) }, contentAt)
  return { start, busy: starting || line?.tone === 'running', line }
}

/** The run's status under the card's title: generating, or why the last one failed. */
export function AiRunLine({ line }: { line: ReturnType<typeof aiRunLine> }) {
  if (!line) return null
  return line.tone === 'running'
    ? <p className="text-xs text-muted-foreground flex items-center gap-1.5" role="status"><Loader2 className="w-3 h-3 animate-spin" aria-hidden />{line.text}</p>
    : <p className="text-xs text-amber-700 dark:text-amber-400 flex items-start gap-1.5" role="status" data-testid="ai-run-failed"><AlertCircle className="w-3.5 h-3.5 mt-px shrink-0" aria-hidden /><span>Last run failed: {line.text}</span></p>
}
