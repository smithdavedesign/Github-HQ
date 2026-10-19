import { NextResponse } from 'next/server'
import { sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { verifyCronSecret } from '@/lib/cron-auth'
import { serverErrorSummary } from '@/lib/monitoring/server-errors'

export const dynamic = 'force-dynamic'

/**
 * Liveness for the collector (every 5 minutes): 200 when the app reaches its database, 503 when it can't. With the
 * cron secret it adds server errors from the last hour, which is how a crash behind sign-in gets noticed. Public
 * callers get only {ok}. Same shape as botchelor's /api/health (factory/system/collector.ts ProductHealth).
 */
export async function GET(request: Request) {
  try {
    await db.execute(sql`select 1`)
  } catch {
    return NextResponse.json({ ok: false, db: 'unreachable' }, { status: 503 })
  }
  if (!verifyCronSecret(request)) return NextResponse.json({ ok: true })
  try {
    return NextResponse.json({ ok: true, errors: await serverErrorSummary() })
  } catch {
    // No server_errors table yet (npm run db:push): still live, just no error detail.
    return NextResponse.json({ ok: true })
  }
}
