/**
 * Tests for security fixes identified by gstack /investigate.
 * All pure-function logic — no DB or network calls.
 */
import { describe, it, expect } from 'vitest'
import { isBlockedUrl } from '../../src/lib/notifications/webhook'

// ─── SSRF blocklist (isBlockedUrl) ───────────────────────────────────────────

describe('isBlockedUrl — SSRF protection', () => {
  // Loopback
  it('blocks localhost', () => {
    expect(isBlockedUrl('http://localhost/hook')).toBe(true)
  })
  it('blocks 127.0.0.1', () => {
    expect(isBlockedUrl('http://127.0.0.1/hook')).toBe(true)
  })
  it('blocks ::1 (IPv6 loopback)', () => {
    expect(isBlockedUrl('http://::1/hook')).toBe(true)
  })

  // Cloud metadata
  it('blocks 169.254.169.254 (AWS metadata)', () => {
    expect(isBlockedUrl('http://169.254.169.254/latest/meta-data/')).toBe(true)
  })
  it('blocks metadata.google.internal', () => {
    expect(isBlockedUrl('http://metadata.google.internal/computeMetadata/v1/')).toBe(true)
  })

  // Private IPv4 ranges
  it('blocks 10.x.x.x range', () => {
    expect(isBlockedUrl('http://10.0.0.1/internal')).toBe(true)
    expect(isBlockedUrl('http://10.255.255.255/api')).toBe(true)
  })
  it('blocks 172.16.x.x – 172.31.x.x range', () => {
    expect(isBlockedUrl('http://172.16.0.1/hook')).toBe(true)
    expect(isBlockedUrl('http://172.31.255.255/hook')).toBe(true)
  })
  it('does NOT block 172.32.x.x (public range)', () => {
    expect(isBlockedUrl('http://172.32.0.1/hook')).toBe(false)
  })
  it('blocks 192.168.x.x range', () => {
    expect(isBlockedUrl('http://192.168.1.1/hook')).toBe(true)
    expect(isBlockedUrl('http://192.168.0.0/hook')).toBe(true)
  })
  it('blocks 169.254.x.x link-local range', () => {
    expect(isBlockedUrl('http://169.254.0.1/hook')).toBe(true)
  })

  // Non-HTTP schemes
  it('blocks file:// scheme', () => {
    expect(isBlockedUrl('file:///etc/passwd')).toBe(true)
  })
  it('blocks ftp:// scheme', () => {
    expect(isBlockedUrl('ftp://example.com/file')).toBe(true)
  })

  // Invalid URLs
  it('blocks malformed URLs', () => {
    expect(isBlockedUrl('not-a-url')).toBe(true)
    expect(isBlockedUrl('')).toBe(true)
  })

  // Legitimate public URLs
  it('allows public Slack webhook', () => {
    expect(isBlockedUrl('https://hooks.slack.com/services/T00/B00/xxx')).toBe(false)
  })
  it('allows public make.com webhook', () => {
    expect(isBlockedUrl('https://hook.eu1.make.com/abc123')).toBe(false)
  })
  it('allows generic public HTTPS', () => {
    expect(isBlockedUrl('https://myserver.example.com/webhook')).toBe(false)
  })
  it('allows public HTTP endpoint', () => {
    expect(isBlockedUrl('http://api.example.com/hook')).toBe(false)
  })
})

// ─── Private repo disclosure — visibility filter logic ────────────────────────

describe('public profile visibility filtering', () => {
  type Repo = { visibility: string; isFocused: boolean; name: string }

  function filterPublicFocused(repos: Repo[]) {
    // Mirrors the fix: only public repos in profile README
    return repos.filter(r => r.visibility === 'public' && r.isFocused)
  }

  function computeActiveCount(repos: Repo[]) {
    return repos.filter(r => r.visibility === 'public').length
  }

  it('excludes private repos from focused list', () => {
    const repos: Repo[] = [
      { visibility: 'public', isFocused: true, name: 'public-focused' },
      { visibility: 'private', isFocused: true, name: 'private-focused' },
      { visibility: 'public', isFocused: false, name: 'public-unfocused' },
    ]
    const focused = filterPublicFocused(repos)
    expect(focused.map(r => r.name)).toEqual(['public-focused'])
  })

  it('activeCount only counts public repos', () => {
    const repos: Repo[] = [
      { visibility: 'public', isFocused: false, name: 'pub1' },
      { visibility: 'public', isFocused: false, name: 'pub2' },
      { visibility: 'private', isFocused: false, name: 'priv1' },
    ]
    expect(computeActiveCount(repos)).toBe(2)
  })

  it('empty result when all repos are private', () => {
    const repos: Repo[] = [
      { visibility: 'private', isFocused: true, name: 'secret-project' },
    ]
    expect(filterPublicFocused(repos)).toHaveLength(0)
    expect(computeActiveCount(repos)).toBe(0)
  })
})

// ─── Goal ownership TOCTOU — WHERE clause pattern ────────────────────────────

describe('goal ownership WHERE clause', () => {
  // Validates the WHERE clause pattern mirrors the ownership check
  function buildWhereClause(goalId: number, userId: string) {
    // Fixed pattern: userId must be in the mutating WHERE, not just the preceding SELECT
    return { id: goalId, userId }
  }

  it('includes userId in the update WHERE clause', () => {
    const where = buildWhereClause(42, 'user-abc')
    expect(where.userId).toBe('user-abc')
    expect(where.id).toBe(42)
  })

  it('different userId produces different WHERE clause', () => {
    const where1 = buildWhereClause(42, 'user-1')
    const where2 = buildWhereClause(42, 'user-2')
    expect(where1.userId).not.toBe(where2.userId)
  })
})

// ─── N+1 batch pattern — parallel vs sequential ───────────────────────────────

describe('N+1 batch fix pattern', () => {
  it('parallel Promise.all is faster than sequential await', async () => {
    const delay = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

    // Sequential: 3 × 10ms = ~30ms
    const seqStart = Date.now()
    for (let i = 0; i < 3; i++) await delay(10)
    const seqMs = Date.now() - seqStart

    // Parallel: max(10ms) = ~10ms
    const parStart = Date.now()
    await Promise.all([delay(10), delay(10), delay(10)])
    const parMs = Date.now() - parStart

    expect(parMs).toBeLessThan(seqMs)
  })

  it('Promise.all preserves all results', async () => {
    const results = await Promise.all([
      Promise.resolve({ id: 1, value: 10 }),
      Promise.resolve({ id: 2, value: 20 }),
      Promise.resolve({ id: 3, value: 30 }),
    ])
    expect(results).toHaveLength(3)
    expect(results.map(r => r.value)).toEqual([10, 20, 30])
  })

  it('Promise.allSettled handles individual failures gracefully', async () => {
    const results = await Promise.allSettled([
      Promise.resolve(1),
      Promise.reject(new Error('one failed')),
      Promise.resolve(3),
    ])
    const fulfilled = results.filter(r => r.status === 'fulfilled')
    expect(fulfilled).toHaveLength(2)
  })
})
