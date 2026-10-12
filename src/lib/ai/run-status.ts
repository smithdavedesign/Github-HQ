/** A manual AI run (Advisor, CEO report) as the dashboard cards see it. */
export interface AiRunStatus {
  id: string
  status: 'running' | 'ok' | 'failed' | 'skipped'
  error: string | null
  startedAt: Date
  finishedAt: Date | null
}

/** A run that's been "running" this long died with its function (Vercel's limit is 300 s). */
export const AI_RUN_STALE_MS = 6 * 60_000

/** What the card should say about the latest run, or null when there's nothing to add. */
export function aiRunLine(run: AiRunStatus | null, contentAt: Date | null, now = new Date()): { tone: 'running' | 'failed'; text: string } | null {
  if (!run) return null
  if (run.status === 'running') {
    if (now.getTime() - run.startedAt.getTime() > AI_RUN_STALE_MS) return { tone: 'failed', text: 'The last run stopped without finishing. Try again.' }
    return { tone: 'running', text: 'Generating…' }
  }
  // A failure older than what's shown is history; only a failure since the last result matters.
  if (run.status === 'failed' && (!contentAt || run.startedAt > contentAt)) return { tone: 'failed', text: run.error ?? 'The last run failed.' }
  return null
}
