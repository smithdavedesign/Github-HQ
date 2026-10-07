/**
 * Is RepoHQ's scheduled data still arriving? Health snapshots are written once a day by the sync
 * cron, so the newest snapshot date says whether the scheduled jobs (sync, security, uptime,
 * digest) are running. They stopped silently for seven weeks in 2026 when GitHub disabled the
 * cron workflows for inactivity (docs/audit-2026-10.md); this is the check that would have caught it.
 *
 * Pure: the dashboard banner and the factory's morning report share it.
 */

/** No snapshot today or yesterday means at least one daily sync was missed. */
export const STALE_AFTER_DAYS = 2

export interface Freshness {
  /** Newest snapshot date (YYYY-MM-DD), or null when there are none yet (new account). */
  latest: string | null
  /** Whole days between that date and today (UTC); null without a snapshot. */
  ageDays: number | null
  stale: boolean
}

export function snapshotFreshness(latest: string | null, now: Date, staleAfterDays = STALE_AFTER_DAYS): Freshness {
  const date = latest?.slice(0, 10) ?? null
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return { latest: null, ageDays: null, stale: false }
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  const ageDays = Math.max(0, Math.round((today - Date.parse(`${date}T00:00:00Z`)) / 86_400_000))
  return { latest: date, ageDays, stale: ageDays >= staleAfterDays }
}

export function staleDataMessage(f: Freshness): string | null {
  if (!f.stale) return null
  return `Scheduled data stopped ${f.ageDays} days ago (last health snapshot ${f.latest}). Health trends, security scans and uptime checks only update on schedule — check the cron workflows: GitHub disables scheduled workflows after 60 days without a commit.`
}

/**
 * Agent HQ (roadmap Phase 81): the factory worker runs on the owner's Mac and finishes a cycle
 * about 13 times a day, so a day and a half without a finished run means it's off — and every
 * agent request is waiting. Null when it's fresh, or when it has never run (not set up yet).
 */
export const FACTORY_STALE_AFTER_HOURS = 36

export function factoryStaleMessage(lastFinishedAt: Date | null, now: Date, staleAfterHours = FACTORY_STALE_AFTER_HOURS): string | null {
  if (!lastFinishedAt) return null
  const hours = Math.floor((now.getTime() - lastFinishedAt.getTime()) / 3_600_000)
  if (hours < staleAfterHours) return null
  return `The factory hasn't finished a run in ${hours} hours (last ${lastFinishedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC), so agent requests are waiting. Check that the Mac is on and plugged in and that its worker runs (bash factory/bin/install-launchd.sh); the Agents page shows the queue.`
}
