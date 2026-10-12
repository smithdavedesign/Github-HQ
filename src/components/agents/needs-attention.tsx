import { AlertTriangle, CheckCircle, Info, XCircle } from 'lucide-react'
import type { AttentionItem } from '@/lib/agents/needs-attention'

const TONE = {
  fail: { icon: XCircle, cls: 'text-red-600' },
  warn: { icon: AlertTriangle, cls: 'text-amber-600' },
  info: { icon: Info, cls: 'text-muted-foreground' },
} as const

/** The few things on the Agents page that want a decision or a fix, above everything else. */
export function NeedsAttention({ items }: { items: AttentionItem[] }) {
  if (!items.length) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-emerald-600" data-testid="needs-attention-clear">
        <CheckCircle className="w-3.5 h-3.5" />Nothing needs attention: no failing checks, and the pipeline is ticking.
      </p>
    )
  }
  return (
    <section className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 space-y-1.5" data-testid="needs-attention">
      <h2 className="text-sm font-semibold">Needs attention ({items.length})</h2>
      {items.map((item, i) => {
        const { icon: Icon, cls } = TONE[item.tone]
        const body = <span className={item.tone === 'info' ? 'text-muted-foreground' : ''} title={item.detail}>{item.text}</span>
        return (
          <p key={i} className="flex items-start gap-1.5 text-xs">
            <Icon className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${cls}`} aria-hidden />
            {item.href ? <a href={item.href} className="hover:underline">{body}</a> : body}
          </p>
        )
      })}
    </section>
  )
}
