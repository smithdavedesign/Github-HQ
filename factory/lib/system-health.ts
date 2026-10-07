import { snapshotFreshness, staleDataMessage } from '../../src/lib/health/freshness'

/**
 * System health for the morning report: the things that broke silently for weeks before the
 * 2026-10 audit (docs/audit-2026-10.md). Scheduled workflows GitHub disabled for inactivity,
 * RepoHQ data that stopped arriving, and Agent HQ requests that fail or sit waiting (roadmap
 * Phase 81 — they replaced the Nexus executor, whose failure rate this block used to watch).
 * Pure; factory/report.ts gathers the inputs.
 */

export interface DisabledWorkflow { repo: string; workflow: string; state: string }

/** Agent HQ requests: resolved in the window by status, and the ones still waiting. */
export interface RequestHealth {
  resolved: Partial<Record<'pr' | 'verified' | 'reported' | 'rejected' | 'failed' | 'cancelled', number>>
  waiting: number
  /** Age of the oldest queued/running request; null when none wait. */
  oldestWaitingHours: number | null
}

export interface SystemHealth {
  /** Workflows GitHub disabled for inactivity across the allowlist; null = couldn't check. */
  disabledWorkflows: DisabledWorkflow[] | null
  /** Newest RepoHQ health snapshot (YYYY-MM-DD); null = no sink or no data. */
  latestSnapshot: string | null
  /** Agent HQ requests over the last 7 days; null = no sink. */
  requests: RequestHealth | null
}

/** From `gh workflow list --all --json name,state`. Manually disabled workflows are a choice, not an incident. */
export function inactivityDisabled(repo: string, workflows: { name: string; state: string }[]): DisabledWorkflow[] {
  return workflows.filter(w => w.state === 'disabled_inactivity').map(w => ({ repo, workflow: w.name, state: w.state }))
}

/** A request waiting this long means the worker isn't draining the queue. */
export const STUCK_REQUEST_HOURS = 48

/**
 * Requests are in trouble when one has waited STUCK_REQUEST_HOURS, or when they fail at least
 * 3 times and more than twice per one that landed (a PR, a held verified change, or a report).
 */
export function requestsFailing(r: RequestHealth): boolean {
  const landed = (r.resolved.pr ?? 0) + (r.resolved.verified ?? 0) + (r.resolved.reported ?? 0)
  const failed = (r.resolved.failed ?? 0) + (r.resolved.rejected ?? 0)
  return (r.oldestWaitingHours ?? 0) >= STUCK_REQUEST_HOURS || (failed >= 3 && failed > landed * 2)
}

export function systemHealthLines(h: SystemHealth, now: Date): { lines: string[]; alarm: boolean } {
  const lines: string[] = []
  let alarm = false
  if (h.disabledWorkflows === null) {
    lines.push('Scheduled workflows: could not check (gh unavailable).')
  } else if (h.disabledWorkflows.length) {
    alarm = true
    const repos = [...new Set(h.disabledWorkflows.map(w => w.repo))]
    lines.push(`⚠ ${h.disabledWorkflows.length} scheduled workflow(s) disabled by GitHub for inactivity: ${h.disabledWorkflows.map(w => `${w.repo.split('/')[1] ?? w.repo} "${w.workflow}"`).join(', ')}. Re-enable: ${repos.map(r => `gh workflow enable <name> --repo ${r}`).join('; ')}.`)
  } else {
    lines.push('Scheduled workflows: all enabled.')
  }
  const fresh = snapshotFreshness(h.latestSnapshot, now)
  const stale = staleDataMessage(fresh)
  if (stale) { alarm = true; lines.push(`⚠ RepoHQ data: ${stale}`) } else if (fresh.latest) lines.push(`RepoHQ data: last health snapshot ${fresh.latest}.`)
  const r = h.requests
  const resolvedCount = r ? Object.values(r.resolved).reduce((n, x) => n + (x ?? 0), 0) : 0
  if (r && (resolvedCount > 0 || r.waiting > 0)) {
    const failing = requestsFailing(r)
    alarm ||= failing
    const order = ['pr', 'verified', 'reported', 'rejected', 'failed', 'cancelled'] as const
    const resolved = order.filter(s => (r.resolved[s] ?? 0) > 0).map(s => `${r.resolved[s]} ${s === 'pr' ? 'PR' : s}`).join(', ') || 'none resolved'
    const waiting = r.waiting > 0 ? ` · ${r.waiting} waiting${r.oldestWaitingHours !== null ? ` (oldest ${r.oldestWaitingHours}h)` : ''}` : ''
    lines.push(`${failing ? '⚠ ' : ''}Agent requests, last 7 days: ${resolved}${waiting}.`)
  }
  return { lines, alarm }
}
