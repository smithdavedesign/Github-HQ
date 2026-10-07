/** Small display helpers for the Agents page (client-safe, no dependencies). */

export function fmtDuration(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

/** "in 3h", "in 12m", "now" — for scheduler next runs. */
export function fmtIn(iso: string | null, now: number): string {
  if (!iso) return '—'
  const s = Math.round((new Date(iso).getTime() - now) / 1000)
  if (s <= 60) return 'now'
  if (s < 3600) return `in ${Math.round(s / 60)}m`
  if (s < 86400 * 2) return `in ${Math.round(s / 3600)}h`
  return `in ${Math.round(s / 86400)}d`
}

/** HH:MM in the viewer's time zone. */
export function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** automation_runs.kind → label. */
export function runKindLabel(kind: string): string {
  const labels: Record<string, string> = {
    'factory-cycle': 'Factory cycle',
    'factory-request': 'Request',
    'factory-report': 'Morning report',
    'factory-scout': 'Model scout',
  }
  if (labels[kind]) return labels[kind]
  if (kind.startsWith('cron:')) return `Cron · ${kind.slice(5)}`
  return kind
}
