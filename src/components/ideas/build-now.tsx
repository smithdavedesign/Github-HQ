'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, Loader2, Rocket, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cancelBuildRequest, requestBuild } from '@/lib/actions/ideas'
import type { BuildNowTarget } from '@/lib/ideas/idea-utils'
import { formatDistanceToNow } from '@/lib/utils'

interface Props {
  slug: string
  name: string
  target: BuildNowTarget
  /** For the confirm dialog (buildNowSteps). */
  steps: string[]
  /** The newest request for this idea, if any. */
  request: { id: number; status: string; label: string; createdAt: string; prUrl: string | null; note: string | null } | null
  /** Set when nothing can be queued here (e.g. idea_build_requests isn't in the database yet). */
  blocked: string | null
}

/**
 * "Start build now" on an idea's page: the pipeline builds its next milestone on the next tick,
 * outside the weekly build slot (idea_build_requests). Confirm first; a queued request can be withdrawn.
 */
export function BuildNow({ slug, name, target, steps, request, blocked }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [busy, startTransition] = useTransition()
  const active = request && (request.status === 'pending' || request.status === 'running')

  const confirm = () => {
    if (!target.ok) return
    startTransition(async () => {
      try {
        const r = await requestBuild(slug, note)
        toast.success(`${r.milestone} build queued: ${name}`, { description: 'The pipeline starts it on its next run (within 15 min) and posts the PR in Slack.' })
        setOpen(false)
        setNote('')
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not queue the build')
      }
    })
  }

  const withdraw = () => {
    if (!request) return
    startTransition(async () => {
      try {
        await cancelBuildRequest(request.id)
        toast.success('Build request withdrawn')
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not withdraw')
      }
    })
  }

  return (
    <div className="space-y-2">
      {request && (
        <div className={active ? 'rounded-lg border border-dashed border-primary/40 bg-primary/5 p-2.5 text-xs' : 'text-xs text-muted-foreground'}>
          <p className={active ? 'font-medium' : undefined}>{request.label}</p>
          {request.prUrl && <a href={request.prUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Open the PR</a>}
          {active && <p className="text-muted-foreground mt-0.5" suppressHydrationWarning>Requested {formatDistanceToNow(request.createdAt)}</p>}
          {active && request.note && <p className="italic mt-1">“{request.note}”</p>}
          {request.status === 'pending' && (
            <Button variant="ghost" size="sm" className="mt-1 -ml-2" onClick={withdraw} disabled={busy}><Undo2 /> Withdraw</Button>
          )}
        </div>
      )}

      {blocked ? <p className="text-xs text-muted-foreground">{blocked}</p> : !active && (
        <>
          <Button className="w-full justify-start" variant="outline" disabled={!target.ok || busy} title={target.ok ? undefined : target.reason} onClick={() => setOpen(true)}>
            <Rocket /> {target.ok ? `Start ${target.milestone} build now` : 'Start build now'}
          </Button>
          {!target.ok && <p className="text-xs text-muted-foreground">{target.reason}</p>}
        </>
      )}

      <Dialog open={open && target.ok} onOpenChange={v => { if (!v && !busy) setOpen(false) }}>
        <DialogContent className="sm:max-w-lg">
          {target.ok && (
            <>
              <DialogHeader>
                <DialogTitle>Start {target.milestone} build now: {name}?</DialogTitle>
                <DialogDescription>What happens next:</DialogDescription>
              </DialogHeader>
              <ol className="space-y-1.5 text-sm list-decimal pl-5">
                {steps.map(s => <li key={s}>{s}</li>)}
              </ol>
              <label className="block space-y-1.5">
                <span className="text-xs text-muted-foreground">Note (optional): the builder reads it with the PRD, so say what to focus on in {target.milestone}.</span>
                <textarea
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) confirm() }}
                  maxLength={1000}
                  rows={3}
                  aria-label="Note for the builder"
                  className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                  placeholder="e.g. CLI first; skip the web UI in M1"
                />
              </label>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
                <Button onClick={confirm} disabled={busy} autoFocus>
                  {busy ? <Loader2 className="animate-spin" /> : <Check />} Start {target.milestone} build
                  <kbd className="ml-1 text-[10px] font-mono opacity-60">⌘↵</kbd>
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
