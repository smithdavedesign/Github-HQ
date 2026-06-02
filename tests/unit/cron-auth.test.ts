import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { verifyCronSecret } from '../../src/lib/cron-auth'

function makeRequest(authHeader?: string): Request {
  const headers = new Headers()
  if (authHeader !== undefined) headers.set('authorization', authHeader)
  return new Request('http://localhost/api/cron/sync', { headers })
}

describe('verifyCronSecret', () => {
  const ORIGINAL_SECRET = process.env.CRON_SECRET

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) {
      delete process.env.CRON_SECRET
    } else {
      process.env.CRON_SECRET = ORIGINAL_SECRET
    }
  })

  it('returns false when CRON_SECRET env var is not set (fail-secure)', () => {
    delete process.env.CRON_SECRET
    expect(verifyCronSecret(makeRequest('Bearer anything'))).toBe(false)
  })

  it('returns false when CRON_SECRET is empty string (fail-secure)', () => {
    process.env.CRON_SECRET = ''
    expect(verifyCronSecret(makeRequest('Bearer '))).toBe(false)
  })

  it('returns true with the correct bearer token', () => {
    process.env.CRON_SECRET = 'super-secret-abc123'
    expect(verifyCronSecret(makeRequest('Bearer super-secret-abc123'))).toBe(true)
  })

  it('returns false with a wrong token', () => {
    process.env.CRON_SECRET = 'super-secret-abc123'
    expect(verifyCronSecret(makeRequest('Bearer wrong-token'))).toBe(false)
  })

  it('returns false with no Authorization header', () => {
    process.env.CRON_SECRET = 'super-secret-abc123'
    expect(verifyCronSecret(makeRequest())).toBe(false)
  })

  it('returns false with malformed bearer prefix', () => {
    process.env.CRON_SECRET = 'super-secret-abc123'
    expect(verifyCronSecret(makeRequest('super-secret-abc123'))).toBe(false)
  })
})
