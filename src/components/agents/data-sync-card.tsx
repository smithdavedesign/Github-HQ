import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { RefreshCw } from 'lucide-react'
import { formatDistanceToNow } from '@/lib/utils'

/** Mirrors .github/workflows/cron-*.yml, the canonical triggers (AGENTS.md "Cron jobs"). */
const SCHEDULES = [
  { label: 'GitHub sync', schedule: 'every 6 h' },
  { label: 'Security scan', schedule: 'daily 03:00 UTC' },
  { label: 'Deployment checks', schedule: 'every 12 h' },
  { label: 'AI summaries', schedule: 'Sun 05:00 UTC' },
  { label: 'Weekly digest', schedule: 'Mon 06:00 UTC' },
]

const STATUS_STYLE: Record<string, string> = {
  complete: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20',
  running: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
  failed: 'bg-red-500/10 text-red-600 border-red-500/20',
}

export interface SyncScan {
  id: number
  status: string | null
  type: string
  totalRepos: number | null
  processedRepos: number | null
  startedAt: Date | null
}

/** RepoHQ's own data pipeline: recent syncs and the scheduled jobs (moved here from Settings). */
export function DataSyncCard({ scans }: { scans: SyncScan[] }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <RefreshCw className="w-4 h-4" />
          Data sync
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-6 sm:grid-cols-2 text-sm">
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Recent syncs</p>
          {scans.length === 0 ? (
            <p className="text-xs text-muted-foreground">No syncs yet. Use the Sync button in the top bar.</p>
          ) : scans.map(s => (
            <div key={s.id} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 min-w-0">
                <Badge variant="outline" className={`capitalize text-[10px] h-5 ${STATUS_STYLE[s.status ?? ''] ?? 'bg-muted text-muted-foreground'}`}>{s.status ?? 'pending'}</Badge>
                {s.totalRepos ? <span className="text-xs text-muted-foreground">{s.processedRepos}/{s.totalRepos} repos</span> : null}
              </span>
              <span className="text-xs text-muted-foreground shrink-0">{formatDistanceToNow(s.startedAt)}</span>
            </div>
          ))}
        </div>
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">Scheduled jobs (GitHub Actions)</p>
          {SCHEDULES.map(j => (
            <div key={j.label} className="flex items-center justify-between gap-2">
              <span>{j.label}</span>
              <span className="text-xs text-muted-foreground">{j.schedule}</span>
            </div>
          ))}
          <p className="text-xs text-muted-foreground pt-1">GitHub pauses them after 60 days without a commit; a banner appears when data stops arriving.</p>
        </div>
      </CardContent>
    </Card>
  )
}
