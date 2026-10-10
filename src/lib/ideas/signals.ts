import { createHmac } from 'node:crypto'

/**
 * Demand signals from idea landing pages (docs/idea-factory.md, "Demand test"). Pure: parsing,
 * validation, hashing and rate limits are decided here; the route only reads and writes rows.
 */

export type SignalKind = 'view' | 'signup'
export interface Signal { slug: string; kind: SignalKind; email: string | null; referrer: string | null }

/** Same rule as idea-factory's repo names: lowercase kebab-case, 3–24 chars, at most 2 words. */
export const SLUG_RE = /^(?=.{3,24}$)[a-z][a-z0-9]*(-[a-z0-9]+)?$/
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i

/** Per visitor (hashed IP) and hour, across all ideas. */
export const RATE_LIMITS: Record<SignalKind, number> = { view: 30, signup: 3 }

export function parseSignal(body: unknown): { ok: true; signal: Signal } | { ok: false; error: string; silent?: boolean } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'expected a JSON object' }
  const b = body as Record<string, unknown>
  // Honeypot: a field humans never see. Bots that fill it get a 200 and nothing is stored.
  if (typeof b.website === 'string' && b.website.trim()) return { ok: false, error: 'honeypot', silent: true }
  const slug = typeof b.slug === 'string' ? b.slug.trim() : ''
  if (!SLUG_RE.test(slug)) return { ok: false, error: 'invalid slug' }
  const kind = b.kind
  if (kind !== 'view' && kind !== 'signup') return { ok: false, error: 'kind must be view or signup' }
  let email: string | null = null
  if (kind === 'signup') {
    email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : ''
    if (email.length > 254 || !EMAIL_RE.test(email)) return { ok: false, error: 'invalid email' }
  }
  const referrer = typeof b.referrer === 'string' && /^https?:\/\//.test(b.referrer) ? b.referrer.slice(0, 300) : null
  return { ok: true, signal: { slug, kind, email, referrer } }
}

/** HMAC of the client IP: enough for unique visitors and rate limits; the IP itself is never stored. */
export function hashIp(ip: string | null, secret: string): string | null {
  if (!ip) return null
  return createHmac('sha256', secret).update(ip.trim()).digest('hex').slice(0, 32)
}

/** First address in x-forwarded-for (Vercel sets it), else x-real-ip. */
export function clientIp(headers: { get(name: string): string | null }): string | null {
  const fwd = headers.get('x-forwarded-for')
  if (fwd) return fwd.split(',')[0]!.trim() || null
  return headers.get('x-real-ip')
}

export function overLimit(kind: SignalKind, recentFromSameVisitor: number): boolean {
  return recentFromSameVisitor >= RATE_LIMITS[kind]
}

/** Landing pages are public static pages on another origin; no cookies are involved. */
export const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
}
