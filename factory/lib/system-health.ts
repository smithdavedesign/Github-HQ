import { snapshotFreshness, staleDataMessage } from '../../src/lib/health/freshness'

/**
 * System health for the morning report: the things that broke silently for weeks before the
 * 2026-10 audit (docs/audit-2026-10.md). Scheduled workflows GitHub disabled for inactivity,
 * RepoHQ data that stopped arriving, and a remote executor that fails far more than it ships.
 * Pure; factory/report.ts gathers the inputs.
 */

export interface DisabledWorkflow { repo: string; workflow: string; state: string }

export interface SystemHealth {
  /** Workflows GitHub disabled for inactivity across the allowlist; null = couldn't check. */
  disabledWorkflows: DisabledWorkflow[] | null
  /** Newest RepoHQ health snapshot (YYYY-MM-DD); null = no sink or no data. */
  latestSnapshot: string | null
  /** Nexus outcomes over the last 7 days; null = no sink. */
  nexus: { queued: number; failed: number; prs: number } | null
}

/** From `gh workflow list --all --json name,state`. Manually disabled workflows are a choice, not an incident. */
export function inactivityDisabled(repo: string, workflows: { name: string; state: string }[]): DisabledWorkflow[] {
  return workflows.filter(w => w.state === 'disabled_inactivity').map(w => ({ repo, workflow: w.name, state: w.state }))
}

/** A remote executor is failing when it fails at least 3 times and more than twice per PR it opens. */
export function nexusFailing(n: { failed: number; prs: number }): boolean {
  return n.failed >= 3 && n.failed > n.prs * 2
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
  if (h.nexus && h.nexus.queued + h.nexus.failed > 0) {
    const failing = nexusFailing(h.nexus)
    alarm ||= failing
    lines.push(`${failing ? '⚠ ' : ''}Nexus, last 7 days: ${h.nexus.queued} queued, ${h.nexus.failed} failed, ${h.nexus.prs} PR(s) opened.`)
  }
  return { lines, alarm }
}
