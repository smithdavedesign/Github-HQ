'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Loader2, Plus, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cancelIdeaSeed, submitIdea } from '@/lib/actions/ideas'
import { SEED_MAX, SEED_MIN, seedStatusLabel, type IdeaSeedRow } from '@/lib/ideas/idea-utils'
import { cn } from '@/lib/utils'

/**
 * "New idea": the same research queue as "idea: …" on Slack or WhatsApp. Below it, what was
 * submitted and where each one stands (waiting → queued → researched).
 */
export function NewIdea({ seeds }: { seeds: IdeaSeedRow[] }) {
  const router = useRouter()
  const [text, setText] = useState('')
  const [busy, startTransition] = useTransition()
  const trimmed = text.trim()

  const submit = () => {
    if (trimmed.length < SEED_MIN || busy) return
    startTransition(async () => {
      try {
        await submitIdea(trimmed)
        toast.success('Idea queued for research', { description: 'Researched and reviewed within about half an hour (up to 3 a day); the verdict lands here and in Slack.' })
        setText('')
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not queue the idea')
      }
    })
  }

  const withdraw = (id: number) => startTransition(async () => {
    try {
      await cancelIdeaSeed(id)
      toast.success('Idea withdrawn')
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not withdraw it')
    }
  })

  const waiting = seeds.filter(s => s.status === 'queued')
  return (
    <div className="rounded-xl border bg-card p-4 space-y-3">
      <label className="block space-y-1.5">
        <span className="text-sm font-medium">New idea</span>
        <span className="block text-xs text-muted-foreground">
          A problem or product to research. It joins the same queue as <code className="font-mono">idea: …</code> on Slack or WhatsApp.
        </span>
        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit() } }}
          maxLength={SEED_MAX}
          rows={2}
          placeholder="e.g. warn Airbnb co-hosts when a city changes its short-term-rental rules"
          className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
        />
      </label>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">Researched and reviewed within about half an hour (up to 3 a day, oldest first), then it shows up here for your call and the verdict goes to Slack.</p>
        <Button size="sm" onClick={submit} disabled={busy || trimmed.length < SEED_MIN}>
          {busy ? <Loader2 className="animate-spin" /> : <Plus />} Queue for research
          <kbd className="ml-1 text-[10px] font-mono opacity-60 max-sm:hidden">⌘↵</kbd>
        </Button>
      </div>

      {seeds.length > 0 && (
        <ul className="border-t pt-3 space-y-2">
          {seeds.map(s => {
            const ahead = s.status === 'queued' ? waiting.findIndex(w => w.id === s.id) : 0
            return (
              <li key={s.id} className="flex items-start justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="line-clamp-2">{s.text}</p>
                  <p className={cn('text-xs', s.status === 'failed' ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground')}>
                    {s.status === 'researched' && s.slug
                      ? <>Researched: <Link href={`/ideas/${s.slug}`} className="text-primary hover:underline">open {s.slug}</Link></>
                      : seedStatusLabel(s, ahead)}
                  </p>
                </div>
                {s.status === 'pending' && (
                  <Button variant="ghost" size="sm" onClick={() => withdraw(s.id)} disabled={busy}><Undo2 />Withdraw</Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
