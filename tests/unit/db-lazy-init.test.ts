import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Tests for src/lib/db/index.ts lazy-init Proxy.
 *
 * The db export must NOT call neon() at module-evaluation time — this
 * allows Next.js to build edge-runtime bundles even when DATABASE_URL
 * is absent (e.g. Vercel preview builds, CI).  The actual connection is
 * created on the first property access.
 */
describe('db lazy init', () => {
  const savedUrl = process.env.DATABASE_URL

  beforeEach(() => {
    // Clear module registry so each test gets a fresh import
    vi.resetModules()
  })

  afterEach(() => {
    // Restore DATABASE_URL exactly as it was
    if (savedUrl === undefined) {
      delete process.env.DATABASE_URL
    } else {
      process.env.DATABASE_URL = savedUrl
    }
    vi.restoreAllMocks()
  })

  it('does NOT call neon() at import time', async () => {
    const mockNeon = vi.fn(() => ({}))
    vi.doMock('@neondatabase/serverless', () => ({ neon: mockNeon }))
    vi.doMock('drizzle-orm/neon-http', () => ({ drizzle: vi.fn(() => ({ query: {} })) }))

    process.env.DATABASE_URL = 'postgresql://u:p@host/db'
    await import('@/lib/db')

    // Import alone must not trigger neon()
    expect(mockNeon).not.toHaveBeenCalled()
  })

  it('calls neon() with DATABASE_URL on first property access', async () => {
    const mockNeon = vi.fn(() => ({}))
    vi.doMock('@neondatabase/serverless', () => ({ neon: mockNeon }))
    vi.doMock('drizzle-orm/neon-http', () => ({ drizzle: vi.fn(() => ({ query: {} })) }))

    process.env.DATABASE_URL = 'postgresql://u:p@host/db'
    const { db } = await import('@/lib/db')

    // Trigger lazy init
    void (db as unknown as Record<string, unknown>).query

    expect(mockNeon).toHaveBeenCalledOnce()
    expect(mockNeon).toHaveBeenCalledWith('postgresql://u:p@host/db')
  })

  it('initialises the connection only once across multiple accesses (singleton)', async () => {
    const mockNeon = vi.fn(() => ({}))
    vi.doMock('@neondatabase/serverless', () => ({ neon: mockNeon }))
    vi.doMock('drizzle-orm/neon-http', () => ({
      drizzle: vi.fn(() => ({ query: {}, select: {}, insert: {} })),
    }))

    process.env.DATABASE_URL = 'postgresql://u:p@host/db'
    const { db } = await import('@/lib/db')
    const d = db as unknown as Record<string, unknown>

    void d.query
    void d.select
    void d.insert

    expect(mockNeon).toHaveBeenCalledOnce()
  })

  it('throws a descriptive error when DATABASE_URL is not set', async () => {
    vi.doMock('@neondatabase/serverless', () => ({ neon: vi.fn() }))
    vi.doMock('drizzle-orm/neon-http', () => ({ drizzle: vi.fn(() => ({})) }))

    delete process.env.DATABASE_URL
    const { db } = await import('@/lib/db')

    expect(() => (db as unknown as Record<string, unknown>).query).toThrow(
      'DATABASE_URL is not set',
    )
  })

  it('error message includes Vercel settings guidance', async () => {
    vi.doMock('@neondatabase/serverless', () => ({ neon: vi.fn() }))
    vi.doMock('drizzle-orm/neon-http', () => ({ drizzle: vi.fn(() => ({})) }))

    delete process.env.DATABASE_URL
    const { db } = await import('@/lib/db')

    expect(() => (db as unknown as Record<string, unknown>).query).toThrow(
      /Vercel.*Settings.*Environment Variables/,
    )
  })
})
