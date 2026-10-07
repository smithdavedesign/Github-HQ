import 'server-only'

/**
 * Records each scheduled cron route call as an `automation_runs` row (roadmap Phase 81,
 * docs/agent-hq-migration-prd.md §5, §9), so the Agents page shows the GitHub Actions crons on
 * the same timeline as the factory's jobs — the seven-week silent outage in the 2026-10 audit
 * is the case this makes visible. The schedules themselves stay in .github/workflows (AGENTS.md).
 *
 * Recording never breaks the route: a failed write is logged and the route runs as before.
 */
import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db'
import { automationRuns } from '@/lib/db/schema'
import { verifyCronSecret } from '@/lib/cron-auth'

type Handler = (request: Request) => Promise<Response>

async function safely(label: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn()
  } catch (err) {
    console.warn(`[automation-runs] ${label} failed:`, err instanceof Error ? err.message : err)
  }
}

/** Response JSON → a small summary for the run row (counts and flags, not payloads). */
export function summarize(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
    if (typeof v === 'number' || typeof v === 'boolean') out[k] = v
    else if (typeof v === 'string' && v.length <= 200) out[k] = v
    else if (Array.isArray(v)) out[k] = v.length // e.g. errors: [...] → how many
  }
  return out
}

/**
 * Wrap a cron route: authorised calls (CRON_SECRET) are recorded from start to finish.
 * `shouldRecord` narrows it for routes driven in a loop (ai-summary processes one job per call).
 */
export function withAutomationRun(kind: string, handler: Handler, shouldRecord: (request: Request) => boolean = () => true): Handler {
  return async (request: Request) => {
    // Unauthorised calls are answered by the route itself (401) and are not runs.
    if (!verifyCronSecret(request) || !shouldRecord(request)) return handler(request)
    const id = randomUUID()
    await safely('start', () => db.insert(automationRuns).values({ id, kind, trigger: 'schedule', status: 'running', startedAt: new Date() }))
    try {
      const response = await handler(request)
      const body = await response.clone().json().catch(() => null)
      await safely('finish', () => db.update(automationRuns)
        .set({
          status: response.ok ? 'ok' : 'failed',
          summary: summarize(body),
          error: response.ok ? null : `HTTP ${response.status}`,
          finishedAt: new Date(),
        })
        .where(eq(automationRuns.id, id)))
      return response
    } catch (err) {
      await safely('fail', () => db.update(automationRuns)
        .set({ status: 'failed', error: (err instanceof Error ? err.message : String(err)).slice(0, 2_000), finishedAt: new Date() })
        .where(eq(automationRuns.id, id)))
      throw err
    }
  }
}
