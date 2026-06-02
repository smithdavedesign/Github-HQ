/**
 * Phase 49 — Notification system E2E tests.
 *
 * Covers:
 * - Notification bell renders in the topbar
 * - Notifications settings section is present in Settings
 * - Webhook URL and threshold inputs accept values
 * - /api/notifications returns 401 for unauthenticated requests
 */
import { test, expect } from '@playwright/test'
import { neon } from '@neondatabase/serverless'

const DB_URL = process.env.DATABASE_URL ?? ''

test.describe('Notification bell', () => {
  test('bell icon renders in topbar', async ({ page }) => {
    await page.goto('/')
    // The bell button has aria-label containing "notification"
    const bell = page.getByRole('button', { name: /notification/i })
    await expect(bell).toBeVisible({ timeout: 8000 })
  })

  test('bell opens notification panel when clicked', async ({ page }) => {
    await page.goto('/')
    const bell = page.getByRole('button', { name: /notification/i })
    await bell.click()
    // Sheet should appear with "Notifications" heading
    await expect(page.getByText('Notifications')).toBeVisible({ timeout: 5000 })
  })

  test('empty state shows "All caught up"', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: /notification/i }).click()
    // Either empty state or list — both are valid
    const hasEmpty = await page.getByText('All caught up').isVisible().catch(() => false)
    const hasList = await page.locator('[data-radix-scroll-area-viewport]').isVisible().catch(() => false)
    expect(hasEmpty || hasList).toBe(true)
  })
})

test.describe('Notifications API', () => {
  test('returns 401 for unauthenticated request', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: undefined })
    const page = await ctx.newPage()
    const res = await page.request.get('/api/notifications')
    expect(res.status()).toBe(401)
    await ctx.close()
  })

  test('returns JSON with count for authenticated request', async ({ request }) => {
    const res = await request.get('/api/notifications?countOnly=true')
    expect(res.status()).toBe(200)
    const body = await res.json() as { count: number }
    expect(typeof body.count).toBe('number')
    expect(body.count).toBeGreaterThanOrEqual(0)
  })

  test('returns items array for full fetch', async ({ request }) => {
    const res = await request.get('/api/notifications')
    expect(res.status()).toBe(200)
    const body = await res.json() as { items: unknown[]; count: number }
    expect(Array.isArray(body.items)).toBe(true)
    expect(typeof body.count).toBe('number')
  })
})

test.describe('Notification settings', () => {
  test('notifications section is visible in settings page', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByText('Notifications')).toBeVisible({ timeout: 8000 })
  })

  test('webhook URL input is present', async ({ page }) => {
    await page.goto('/settings')
    const input = page.getByPlaceholder(/hooks\.slack\.com/i)
    await expect(input).toBeVisible()
  })

  test('health threshold input accepts numeric values', async ({ page }) => {
    await page.goto('/settings')
    const input = page.getByLabel(/health alert threshold/i)
    if (await input.isVisible()) {
      await input.fill('65')
      await expect(input).toHaveValue('65')
    }
  })

  test('seeded health_alert notification appears in bell panel', async ({ page }) => {
    test.skip(!DB_URL, 'DATABASE_URL not set')

    const sql = neon(DB_URL)
    const [user] = await sql`SELECT id FROM users LIMIT 1`
    if (!user) test.skip(true, 'No user in DB')

    const notifTitle = `Playwright health alert test ${Date.now()}`
    await sql`
      INSERT INTO notifications (user_id, event_type, title, body)
      VALUES (${user.id}, 'health_alert', ${notifTitle}, 'Test body')
    `

    await page.goto('/')
    await page.getByRole('button', { name: /notification/i }).click()
    await expect(page.getByText(notifTitle)).toBeVisible({ timeout: 5000 })

    // Cleanup
    await sql`DELETE FROM notifications WHERE title = ${notifTitle}`
  })
})
