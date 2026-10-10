import { NextResponse } from 'next/server'
import { and, count, eq, gt } from 'drizzle-orm'
import { db } from '@/lib/db'
import { ideaSignals } from '@/lib/db/schema'
import { CORS_HEADERS, clientIp, hashIp, overLimit, parseSignal } from '@/lib/ideas/signals'

/**
 * Public endpoint for idea landing pages: records a page view or a waitlist signup
 * (docs/idea-factory.md, "Demand test"). No auth by design; abuse is bounded by validation,
 * a honeypot and per-visitor hourly limits. Never returns stored data.
 */
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS })
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null)
  const parsed = parseSignal(body)
  if (!parsed.ok) {
    return NextResponse.json(parsed.silent ? { ok: true } : { ok: false, error: parsed.error },
      { status: parsed.silent ? 200 : 400, headers: CORS_HEADERS })
  }
  const { signal } = parsed
  const ipHash = hashIp(clientIp(req.headers), process.env.IDEA_SIGNAL_SALT ?? process.env.CRON_SECRET ?? 'repohq-ideas')
  if (ipHash) {
    const [recent] = await db.select({ n: count() }).from(ideaSignals).where(and(
      eq(ideaSignals.ipHash, ipHash), eq(ideaSignals.kind, signal.kind), gt(ideaSignals.createdAt, new Date(Date.now() - 3_600_000)),
    ))
    if (overLimit(signal.kind, Number(recent?.n ?? 0))) {
      return NextResponse.json({ ok: false, error: 'rate limited' }, { status: 429, headers: CORS_HEADERS })
    }
  }
  await db.insert(ideaSignals).values({ slug: signal.slug, kind: signal.kind, email: signal.email, ipHash, referrer: signal.referrer })
  return NextResponse.json({ ok: true }, { headers: CORS_HEADERS })
}
