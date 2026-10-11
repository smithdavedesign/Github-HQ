'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Check, FlaskConical, Hammer, Loader2, Undo2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { cancelIdeaDecision, decideIdea } from '@/lib/actions/ideas'
import { DECISION_LABEL, type DecisionCheck, type IdeaDecisionKind } from '@/lib/ideas/idea-utils'
import { formatDistanceToNow } from '@/lib/utils'

export interface DecisionOption { kind: IdeaDecisionKind; label: string; check: DecisionCheck; steps: string[] }

interface Props {
  slug: string
  name: string
  options: DecisionOption[]
  pending: { id: number; decision: IdeaDecisionKind; createdAt: string; note: string | null } | null
  /** The next idea in the review queue: the page moves on after a decision. */
  nextSlug: string | null
  /** Set when nothing can be decided here (e.g. the pipeline's tables aren't set up). */
  blocked: string | null
}

const ICON = { build: Hammer, validate: FlaskConical, pass: X } as const
const KEY: Record<string, IdeaDecisionKind> = { a: 'build', t: 'validate', p: 'pass' }
const DONE: Record<IdeaDecisionKind, string> = {
  build: 'Build approved',
  validate: 'Sent to a demand test',
  pass: 'Passed',
}
/** Phone action bar: three buttons side by side. */
const SHORT: Record<IdeaDecisionKind, string> = { build: 'Build', validate: 'Test', pass: 'Pass' }

const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))

export function DecisionPanel({ slug, name, options, pending, nextSlug, blocked }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState<IdeaDecisionKind | null>(null)
  const [note, setNote] = useState('')
  const [busy, startTransition] = useTransition()
  const chosen = options.find(o => o.kind === open) ?? null

  // A / T / P open the confirm dialog for that decision (never act straight from a keypress).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (open || blocked || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return
      const kind = KEY[e.key.toLowerCase()]
      if (kind && options.find(o => o.kind === kind)?.check.ok) {
        e.preventDefault()
        setOpen(kind)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, blocked, options])

  const confirm = () => {
    if (!chosen) return
    startTransition(async () => {
      try {
        await decideIdea(slug, chosen.kind, note)
        toast.success(`${chosen.label === DECISION_LABEL[chosen.kind] ? DONE[chosen.kind] : chosen.label}: ${name}`, { description: 'The idea pipeline applies it on its next run (within 15 min).' })
        setOpen(null)
        setNote('')
        if (nextSlug) router.push(`/ideas/${nextSlug}`)
        else router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not record the decision')
      }
    })
  }

  const cancel = () => {
    if (!pending) return
    startTransition(async () => {
      try {
        await cancelIdeaDecision(pending.id)
        toast.success('Decision withdrawn')
        router.refresh()
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Could not cancel')
      }
    })
  }

  return (
    <div className="space-y-3">
      {pending && (
        <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3 text-sm max-lg:p-2 max-lg:text-xs">
          <p className="font-medium" suppressHydrationWarning>{DECISION_LABEL[pending.decision]} queued {formatDistanceToNow(pending.createdAt)}</p>
          <p className="text-xs text-muted-foreground mt-1 max-lg:hidden">The pipeline applies it on its next run. Choose again below to change it.</p>
          {pending.note && <p className="text-xs mt-2 italic max-lg:hidden">“{pending.note}”</p>}
          <Button variant="ghost" size="sm" className="mt-2 -ml-2 max-lg:mt-1" onClick={cancel} disabled={busy}>
            <Undo2 /> Withdraw
          </Button>
        </div>
      )}

      {blocked ? (
        <p className="text-sm text-muted-foreground">{blocked}</p>
      ) : (
        <>
          <div className="grid gap-2 max-lg:grid-cols-3">
            {options.map(o => {
              const Icon = ICON[o.kind]
              const isPending = pending?.decision === o.kind
              return (
                <Button
                  key={o.kind}
                  variant={o.kind === 'build' ? 'default' : o.kind === 'pass' ? 'destructive' : 'outline'}
                  className="justify-start h-9 max-lg:justify-center"
                  disabled={!o.check.ok || busy || isPending}
                  title={o.check.ok ? undefined : o.check.reason}
                  aria-label={o.label}
                  onClick={() => setOpen(o.kind)}
                >
                  <Icon /> <span className="lg:hidden">{o.label.startsWith('Agree') ? 'Agree' : SHORT[o.kind]}</span><span className="max-lg:hidden">{o.label}</span>
                  <kbd className="ml-auto text-[10px] font-mono opacity-60 border rounded px-1 max-lg:hidden">{Object.entries(KEY).find(([, k]) => k === o.kind)?.[0].toUpperCase()}</kbd>
                </Button>
              )
            })}
          </div>
          {options.filter(o => !o.check.ok).map(o => (
            <p key={o.kind} className="text-xs text-muted-foreground max-lg:hidden">{o.label}: {(o.check as { reason: string }).reason}</p>
          ))}
        </>
      )}

      <Dialog open={!!chosen} onOpenChange={v => { if (!v && !busy) setOpen(null) }}>
        <DialogContent className="sm:max-w-lg">
          {chosen && (
            <>
              <DialogHeader>
                <DialogTitle>{chosen.label}: {name}?</DialogTitle>
                <DialogDescription>What happens next:</DialogDescription>
              </DialogHeader>
              <ol className="space-y-1.5 text-sm list-decimal pl-5">
                {chosen.steps.map(s => <li key={s}>{s}</li>)}
              </ol>
              <label className="block space-y-1.5">
                <span className="text-xs text-muted-foreground">
                  {chosen.kind === 'build'
                    ? 'Note (optional): the builder reads it with the PRD, so say what to focus on or change in M1.'
                    : 'Note (optional): kept with the decision, so you remember why.'}
                </span>
                <textarea
                  value={note}
                  onChange={e => setNote(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) confirm() }}
                  maxLength={1000}
                  rows={3}
                  className="w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
                  placeholder={chosen.kind === 'pass' ? 'e.g. crowded market, no wedge' : chosen.kind === 'build' ? 'e.g. target co-hosts with 3–15 units; skip the ICS feed in M1' : 'e.g. worth $0 to find out'}
                />
              </label>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(null)} disabled={busy}>Cancel</Button>
                <Button variant={chosen.kind === 'pass' ? 'destructive' : 'default'} onClick={confirm} disabled={busy} autoFocus>
                  {busy ? <Loader2 className="animate-spin" /> : <Check />} {chosen.label}
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
