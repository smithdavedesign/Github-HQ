/**
 * The dashboard's Advisor and CEO report loaders, with the digest row mocked. From 2026-08-17 to
 * 2026-10-12 no digest was written, and both cards showed nothing after every successful run: the
 * content was judged by its digest row's August date instead of its own.
 */
import { describe, expect, it, vi } from 'vitest'

const row: { advisorContent?: unknown; ceoReport?: unknown; generatedAt: Date } = { generatedAt: new Date('2026-08-17T06:12:48Z') }
vi.mock('@/lib/db', () => ({ db: { query: { digests: { findFirst: async () => row } } } }))
vi.mock('@/lib/auth', () => ({ auth: async () => null }))

const { getLatestAdvisor } = await import('@/lib/ai/advisor')
const { getLatestCeoReport } = await import('@/lib/ai/ceo-report')

const daysAgo = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString()

describe('getLatestAdvisor / getLatestCeoReport', () => {
  it("show a fresh Advisor and CEO report stored on a weeks-old digest row", async () => {
    row.advisorContent = { generatedAt: daysAgo(1), actions: [] }
    row.ceoReport = { generatedAt: daysAgo(1), closingLine: 'Ship the beacon.' }
    expect(await getLatestAdvisor('u1')).toMatchObject({ actions: [] })
    expect(await getLatestCeoReport('u1')).toMatchObject({ closingLine: 'Ship the beacon.' })
  })
  it('still expire after 8 days', async () => {
    row.advisorContent = { generatedAt: daysAgo(9), actions: [] }
    row.ceoReport = { generatedAt: daysAgo(9), closingLine: 'old' }
    expect(await getLatestAdvisor('u1')).toBeNull()
    expect(await getLatestCeoReport('u1')).toBeNull()
  })
})
