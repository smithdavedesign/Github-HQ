import 'server-only'

/**
 * Server errors, counted so the owner hears about them. On 2026-10-19 the dashboard crashed for every signed-in
 * visit for 7+ hours and nothing alerted: the uptime probe only loads /login. Every page, server component and
 * action error (src/instrumentation.ts) becomes a short row; GET /api/health reports the last hour to the
 * collector, which alerts #team-agents. Recording is best effort: it never throws.
 */
import { gt, lt, desc, count } from 'drizzle-orm'
import { db } from '@/lib/db'
import { serverErrors } from '@/lib/db/schema'
import { routePattern, cleanMessage } from './error-text'

const RETENTION_MS = 7 * 24 * 60 * 60 * 1000

export async function recordServerError(kind: string, path: string, message: string): Promise<void> {
  try {
    await db.insert(serverErrors).values({ kind: kind.slice(0, 20), route: routePattern(path), message: cleanMessage(message) || 'unknown' })
  } catch {
    /* the database may be what failed: the error still reaches the Vercel log */
  }
}

export interface ErrorSummary { last_hour: number; latest: { at: string; kind: string; route: string; message: string } | null }

/** How many errors in the last hour and the latest one; prunes rows past retention on the way. */
export async function serverErrorSummary(now = new Date()): Promise<ErrorSummary> {
  const since = new Date(now.getTime() - 3_600_000)
  await db.delete(serverErrors).where(lt(serverErrors.at, new Date(now.getTime() - RETENTION_MS)))
  const [[{ n }], [latest]] = await Promise.all([
    db.select({ n: count() }).from(serverErrors).where(gt(serverErrors.at, since)),
    db.select().from(serverErrors).where(gt(serverErrors.at, since)).orderBy(desc(serverErrors.at)).limit(1),
  ])
  return {
    last_hour: n,
    latest: latest ? { at: latest.at.toISOString(), kind: latest.kind, route: latest.route, message: latest.message } : null,
  }
}
