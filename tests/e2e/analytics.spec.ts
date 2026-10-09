import { test, expect } from '@playwright/test'
import { neon } from '@neondatabase/serverless'

const DB_URL = process.env.DATABASE_URL ?? ''

async function getContext() {
  const sql = neon(DB_URL)
  const [user] = await sql`SELECT id FROM users ORDER BY last_synced_at DESC NULLS LAST LIMIT 1`
  if (!user) return null
  return { userId: user.id as string }
}

test.describe('Analytics page', () => {
  test('loads the analytics page', async ({ page }) => {
    await page.goto('/analytics')
    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible()
    await expect(page.getByText('Portfolio health trends')).toBeVisible()
  })

  test('shows chart or empty state', async ({ page }) => {
    await page.goto('/analytics')
    // Recharts measures its container asynchronously. isVisible() checks once and ignores its
    // timeout, which flaked on a cold Neon branch; wait for either outcome instead.
    await expect(page.locator('.recharts-wrapper').first().or(page.getByText('No data yet'))).toBeVisible({ timeout: 15_000 })
  })

  test('trend card shows the live snapshot until 3 days of history exist, then the chart', async ({ page }) => {
    // Read-only: the old version deleted the user's health history and re-inserted it row by row,
    // and a timeout mid-restore lost months of real snapshots.
    test.skip(!DB_URL, 'DATABASE_URL not set')
    const ctx = await getContext()
    if (!ctx?.userId) { test.skip(true, 'No user'); return }

    const sql = neon(DB_URL)
    const [row] = await sql`
      SELECT count(DISTINCT h.recorded_date)::int AS days
      FROM health_score_history h JOIN repositories r ON r.id = h.repo_id
      WHERE r.user_id = ${ctx.userId} AND h.recorded_at >= NOW() - INTERVAL '30 days'
    `

    await page.goto('/analytics')
    if ((row?.days ?? 0) < 3) {
      await expect(page.getByText(/Showing live snapshot|No data yet/)).toBeVisible({ timeout: 8000 })
    } else {
      await expect(page.getByText('Showing live snapshot')).toHaveCount(0)
    }
  })
})
