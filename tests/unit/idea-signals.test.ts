import { describe, it, expect } from 'vitest'
import { clientIp, hashIp, overLimit, parseSignal, RATE_LIMITS } from '../../src/lib/ideas/signals'

describe('idea landing-page signals', () => {
  it('accepts a view and a signup, normalising the email', () => {
    expect(parseSignal({ slug: 'pr-receipt', kind: 'view' })).toEqual({ ok: true, signal: { slug: 'pr-receipt', kind: 'view', email: null, referrer: null } })
    const s = parseSignal({ slug: 'tripsplit', kind: 'signup', email: '  Ann@Example.COM ', referrer: 'https://news.ycombinator.com/item?id=1' })
    expect(s).toEqual({ ok: true, signal: { slug: 'tripsplit', kind: 'signup', email: 'ann@example.com', referrer: 'https://news.ycombinator.com/item?id=1' } })
  })
  it('rejects bad slugs, kinds and emails', () => {
    for (const slug of ['', 'A', 'Bad_Slug', '../etc', 'a'.repeat(30), 'one-two-three']) expect(parseSignal({ slug, kind: 'view' }).ok).toBe(false)
    expect(parseSignal({ slug: 'tripsplit', kind: 'buy' }).ok).toBe(false)
    for (const email of ['', 'nope', 'a@b', '<script>@x.com', 'a b@c.com']) expect(parseSignal({ slug: 'tripsplit', kind: 'signup', email }).ok).toBe(false)
    expect(parseSignal(null).ok).toBe(false)
  })
  it('a filled honeypot is accepted silently and stores nothing', () => {
    expect(parseSignal({ slug: 'tripsplit', kind: 'signup', email: 'bot@x.com', website: 'http://spam' })).toEqual({ ok: false, error: 'honeypot', silent: true })
  })
  it('only http(s) referrers are kept', () => {
    const s = parseSignal({ slug: 'tripsplit', kind: 'view', referrer: 'javascript:alert(1)' })
    expect(s.ok && s.signal.referrer).toBe(null)
  })
  it('hashes the IP (stable per secret, never the IP itself) and reads the forwarded address', () => {
    const h = hashIp('203.0.113.7', 's1')!
    expect(h).toHaveLength(32)
    expect(h).toBe(hashIp('203.0.113.7', 's1'))
    expect(h).not.toBe(hashIp('203.0.113.7', 's2'))
    expect(h).not.toContain('203')
    expect(hashIp(null, 's1')).toBe(null)
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' })
    expect(clientIp(headers)).toBe('203.0.113.7')
    expect(clientIp(new Headers({ 'x-real-ip': '198.51.100.2' }))).toBe('198.51.100.2')
  })
  it('limits per visitor and hour: views generously, signups tightly', () => {
    expect(overLimit('signup', RATE_LIMITS.signup - 1)).toBe(false)
    expect(overLimit('signup', RATE_LIMITS.signup)).toBe(true)
    expect(RATE_LIMITS.view).toBeGreaterThan(RATE_LIMITS.signup)
  })
})
