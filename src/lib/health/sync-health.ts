/**
 * Whether RepoHQ's GitHub sync is failing. Pure, relative imports only: the dashboard's banner and
 * the factory's morning report both use it.
 */

export interface SyncRun { status: string | null; error: string | null; startedAt: string }

/**
 * The sync failing (2026-10-08/09: the GitHub token was revoked and every sync failed for a day
 * while the report said all was well). Null when the newest finished sync worked.
 */
export function syncFailure(runs: SyncRun[]): { failures: number; since: string; error: string | null; hint: string } | null {
  const finished = runs.filter(r => r.status === 'complete' || r.status === 'failed')
  const failed: SyncRun[] = []
  for (const r of finished) { if (r.status !== 'failed') break; failed.push(r) }
  if (failed.length === 0) return null
  const error = failed[0].error
  const hint = /bad credentials|401|token/i.test(error ?? '')
    ? 'GitHub rejected the stored sign-in: sign out of RepoHQ and sign back in'
    : 'see the Agents page (Data sync) and the cron-sync workflow logs'
  return { failures: failed.length, since: failed[failed.length - 1].startedAt, error, hint }
}
