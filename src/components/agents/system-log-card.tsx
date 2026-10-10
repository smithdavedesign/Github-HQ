import { CheckCircle, XCircle, ScrollText } from 'lucide-react'
import { formatDistanceToNow } from '@/lib/utils'

export interface SystemLogRow { ts: Date; system: string; component: string; event: string; status: string; message: string }

/**
 * The system log (docs/logging.md): every system's events in one place — what's failing right now,
 * then the latest events. Written by the collector (factory/system/collector.ts).
 */
export function SystemLogCard({ failing, recent }: { failing: SystemLogRow[]; recent: SystemLogRow[] }) {
  return (
    <section className="space-y-2" data-testid="system-log">
      <h2 className="text-sm font-semibold flex items-center gap-2">
        <ScrollText className="w-3.5 h-3.5 text-indigo-500" />
        System log
        <span className="text-[11px] font-normal text-muted-foreground">RepoHQ · factory · idea pipeline · AI stack · OpenClaw · launchd · GitHub crons</span>
      </h2>
      <div className="rounded-lg border border-border/50 p-3 text-xs space-y-2">
        {failing.length === 0 ? (
          <p className="flex items-center gap-1.5 text-emerald-600"><CheckCircle className="w-3.5 h-3.5" />Nothing is failing right now.</p>
        ) : (
          <div className="space-y-1" data-testid="system-log-failing">
            <p className="font-medium text-red-600">Failing now ({failing.length})</p>
            {failing.map(f => (
              <p key={`${f.system}:${f.component}:${f.event}`} className="flex items-start gap-1.5">
                <XCircle className="w-3 h-3 mt-0.5 shrink-0 text-red-500" />
                <span><span className="font-mono">{f.system}/{f.component}</span> — {f.message} <span className="text-muted-foreground">({formatDistanceToNow(f.ts)})</span></span>
              </p>
            ))}
          </div>
        )}
        {recent.length > 0 && (
          <div className="pt-1 border-t border-border/40 space-y-0.5 max-h-72 overflow-y-auto">
            {recent.map((e, i) => (
              <p key={i} className="flex gap-2 text-[11px]">
                <span className="text-muted-foreground shrink-0 w-16 tabular-nums">{formatDistanceToNow(e.ts)}</span>
                <span className={`shrink-0 ${e.status === 'fail' ? 'text-red-500' : 'text-muted-foreground'}`}>{e.status === 'fail' ? '✗' : '·'}</span>
                <span className="font-mono shrink-0">{e.system}/{e.component}</span>
                <span className="truncate">{e.message}</span>
              </p>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
