'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, Globe, Loader2, Rocket, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cancelBuildRequest, requestBuild } from '@/lib/actions/ideas'
import { milestoneRange, type BuildNowTarget, type GoLiveTarget, type MvpTarget } from '@/lib/ideas/idea-utils'
import { formatDistanceToNow } from '@/lib/utils'

interface Props {
  slug: string
  name: string
  target: BuildNowTarget
  /** For the confirm dialog (buildNowSteps). */
  steps: string[]
  /** "Build the MVP": every remaining milestone in one run (buildMvpTarget, buildMvpSteps). Shown when it covers more than one. */
  mvp?: { target: MvpTarget; steps: string[] } | null
  /** "Get it launch-ready": SEO basics, legal pages, payment link, beacon, Vercel project (goLiveTarget, goLiveSteps). */
  golive?: { target: GoLiveTarget; steps: string[] } | null
  /** The newest request for this idea, if any. */
  request: { id: number; status: string; label: string; createdAt: string; prUrl: string | null; note: string | null } | null
  /** Set when nothing can be queued here (e.g. idea_build_requests isn't in the database yet). */
  blocked: string | null
}

/**
 * "Build the MVP" (every remaining milestone in one run) or "Start build now" (one milestone) on an
 * idea's page: the pipeline builds it on the next tick, outside the weekly build slot
 * (idea_build_requests). Confirm first; a queued request can be withdrawn.
 */
export function BuildNow({ slug, name, target, steps, mvp, golive, request, blocked }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState<null | 'milestone' | 'mvp' | 'golive'>(null)
  const mvpOk = mvp?.target.ok && mvp.target.milestones.length > 1 ? mvp.target.milestones : null
  const chosenSteps = open === 'mvp' ? mvp?.steps ?? [] : open === 'golive' ? golive?.steps ?? [] : steps
  const what = open === 'golive' ? 'it launch-ready' : open === 'mvp' && mvpOk ? `the MVP (${milestoneRange(mvpOk)})` : target.ok ? target.milestone : ''
  const canOpen = (m: 'milestone' | 'mvp' | 'golive') => (m === 'mvp' ? !!mvpOk : m === 'golive' ? !!golive?.target.ok : target.ok)
  const [note, setNote] = useState('')
  const [busy, startTransition] = useTransition()
  const active = request && (request.status === 'pending' || request.status === 'running')

  const confirm = () => {
    if (!open || !canOpen(open)) return
    const mode = open
    startTransition(async () => {
      try {
        const r = await requestBuild(slug, note, mode)
        toast.success(`${r.milestone === 'MVP' ? 'MVP build' : r.milestone === 'GOLIVE' ? 'Go-live' : `${r.milestone} build`} queued: ${name}`, { description: 'The pipeline starts it on its next run (within 15 min) and posts the PR in Slack.' })
        setOpen(null)
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
          {mvpOk && (
            <Button className="w-full justify-start" disabled={busy} onClick={() => setOpen('mvp')}>
              <Rocket /> Build the MVP ({milestoneRange(mvpOk)})
            </Button>
          )}
          <Button className="w-full justify-start" variant="outline" disabled={!target.ok || busy} title={target.ok ? undefined : target.reason} onClick={() => setOpen('milestone')}>
            {!mvpOk && <Rocket />} {target.ok ? (mvpOk ? `Just ${target.milestone}` : `Start ${target.milestone} build now`) : 'Start build now'}
          </Button>
          {!target.ok && <p className="text-xs text-muted-foreground">{target.reason}</p>}
          {golive?.target.ok && (
            <Button className="w-full justify-start" variant="outline" disabled={busy} onClick={() => setOpen('golive')}>
              <Globe /> Get it launch-ready
            </Button>
          )}
        </>
      )}

      <Dialog open={!!open && canOpen(open)} onOpenChange={v => { if (!v && !busy) setOpen(null) }}>
        <DialogContent className="sm:max-w-lg">
          {open && (
            <>
              <DialogHeader>
                <DialogTitle>{open === 'golive' ? 'Get it launch-ready' : open === 'mvp' ? `Build ${what}` : `Start ${what} build now`}: {name}?</DialogTitle>
                <DialogDescription>What happens next:</DialogDescription>
              </DialogHeader>
              <ol className="space-y-1.5 text-sm list-decimal pl-5">
                {chosenSteps.map(s => <li key={s}>{s}</li>)}
              </ol>
              <label className="block space-y-1.5">
                <span className="text-xs text-muted-foreground">Note (optional): the builder reads it with the PRD, so say what to focus on in {what}.</span>
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
                <Button variant="outline" onClick={() => setOpen(null)} disabled={busy}>Cancel</Button>
                <Button onClick={confirm} disabled={busy} autoFocus>
                  {busy ? <Loader2 className="animate-spin" /> : <Check />} {open === 'golive' ? 'Make it launch-ready' : open === 'mvp' ? 'Build the MVP' : `Start ${what} build`}
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
