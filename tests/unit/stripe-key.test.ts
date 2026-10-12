/**
 * The Stripe key is stored encrypted (AGENTS.md: no plaintext keys), a key saved before that is
 * encrypted on first use, and the user-id sync lives outside the browser-callable actions.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

let stored: string | null
let session: { user: { id: string } } | null
const writes: string[] = []
const fetchCalls: string[] = []

vi.mock('@/lib/auth', () => ({ auth: async () => session }))
vi.mock('@/lib/db', () => ({
  db: {
    query: {
      users: { findFirst: async () => ({ stripeApiKey: stored }) },
      repositories: { findMany: async () => [] },
    },
    update: () => ({ set: (v: { stripeApiKey?: string }) => ({ where: async () => { if (v.stripeApiKey) { writes.push(v.stripeApiKey); stored = v.stripeApiKey } } }) }),
  },
}))

process.env.ENCRYPTION_KEY = '0'.repeat(63) + '1'
const { resolveStripeKey } = await import('@/lib/stripe/mrr')
const { saveStripeKey, syncStripeMrr } = await import('@/lib/actions/stripe')
const { decrypt } = await import('@/lib/crypto-utils')

beforeEach(() => {
  stored = null; session = { user: { id: 'owner' } }; writes.length = 0; fetchCalls.length = 0
  globalThis.fetch = (async (u: string) => { fetchCalls.push(String(u)); return { ok: true, json: async () => ({ has_more: false, data: [] }) } }) as unknown as typeof fetch
})

describe('Stripe key', () => {
  it('is saved encrypted', async () => {
    await saveStripeKey('saved-key-one')
    expect(writes).toHaveLength(1)
    expect(writes[0].startsWith('enc:')).toBe(true)
    expect(writes[0]).not.toContain('saved-key-one')
    expect(decrypt(writes[0])).toBe('saved-key-one')
  })

  it('a plaintext key from before is encrypted in place on first use, and read back from then on', async () => {
    stored = 'plain-key-two'
    expect(await resolveStripeKey('owner')).toBe('plain-key-two')
    expect(writes).toHaveLength(1)
    expect(stored.startsWith('enc:')).toBe(true)
    expect(await resolveStripeKey('owner')).toBe('plain-key-two')
    expect(writes).toHaveLength(1)
  })

  it('the browser action syncs only the signed-in user, and takes no user id', async () => {
    stored = 'key-three'
    expect(syncStripeMrr.length).toBe(0)
    await expect(syncStripeMrr()).resolves.toEqual({ synced: 0 })
    expect(fetchCalls[0]).toMatch(/^https:\/\/api\.stripe\.com\/v1\/subscriptions/)
    session = null
    await expect(syncStripeMrr()).rejects.toThrow('Unauthorized')
  })
})
