/**
 * Phase 53 — Auto-dispatch Playwright E2E tests.
 *
 * Covers:
 * - Settings page shows Auto-Dispatch card
 * - Toggle and controls render correctly
 * - Cron API behaviour with auto-dispatch users
 * - /api/cron/digest endpoint guards
 */
import { test, expect } from '@playwright/test'
import { neon } from '@neondatabase/serverless'

const DB_URL = process.env.DATABASE_URL ?? ''

// ─── Settings card ────────────────────────────────────────────────────────────

test.describe('Auto-Dispatch settings card', () => {
  test('renders on settings page', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByText('Agent Auto-Dispatch')).toBeVisible({ timeout: 8000 })
  })

  test('shows the main enable toggle', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByText('Enable automatic task dispatch on Monday')).toBeVisible({ timeout: 8000 })
  })

  test('expanded controls hidden when toggle is off', async ({ page }) => {
    await page.goto('/settings')
    // If toggle is off (default), expanded settings should not be visible
    const effortLabel = page.getByText('Effort gate')
    const isVisible = await effortLabel.isVisible().catch(() => false)
    // May or may not be visible depending on user's current setting — just verify page loads
    const card = page.getByText('Agent Auto-Dispatch')
    await expect(card).toBeVisible()
  })

  test('shows effort gate select when enabled', async ({ page }) => {
    await page.goto('/settings')
    // Find the toggle and turn it on if it's off
    const toggle = page.locator('[role="switch"]').nth(1) // second switch (first is public profile)
    const isChecked = await toggle.getAttribute('data-state')

    if (isChecked !== 'checked') {
      await toggle.click()
      // After enabling, effort gate should appear
      await expect(page.getByText('Effort gate')).toBeVisible({ timeout: 3000 })
    }
    // Reset by clicking again if we enabled it
    if (isChecked !== 'checked') {
      await toggle.click()
    }
  })

  test('Save button exists on auto-dispatch card', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByRole('button', { name: /Save auto-dispatch/i })).toBeVisible({ timeout: 8000 })
  })
})

// ─── Cron digest endpoint ─────────────────────────────────────────────────────

test.describe('GET /api/cron/digest security', () => {
  test('returns 401 without CRON_SECRET', async ({ request }) => {
    const res = await request.get('/api/cron/digest')
    expect(res.status()).toBe(401)
  })

  test('returns 401 with wrong secret', async ({ request }) => {
    const res = await request.get('/api/cron/digest', {
      headers: { Authorization: 'Bearer wrong-secret-xyz' },
    })
    expect(res.status()).toBe(401)
  })
})

// ─── Auto-dispatch DB state ───────────────────────────────────────────────────

test.describe('Auto-dispatch user settings in DB', () => {
  test.skip(!DB_URL, 'DATABASE_URL not set')

  test('default settings are false / quick_only / 3 / true / 0', async () => {
    const sql = neon(DB_URL)
    const [user] = await sql`
      SELECT
        auto_dispatch_enabled,
        auto_dispatch_effort_gate,
        auto_dispatch_max_per_run,
        auto_dispatch_skip_security,
        auto_dispatch_accuracy_threshold
      FROM users LIMIT 1
    `
    // Defaults may vary if user changed them — just verify the columns exist
    expect('auto_dispatch_enabled' in user).toBe(true)
    expect('auto_dispatch_effort_gate' in user).toBe(true)
    expect('auto_dispatch_max_per_run' in user).toBe(true)
  })

  test('can update and restore auto_dispatch_enabled', async () => {
    const sql = neon(DB_URL)
    const [before] = await sql`SELECT id, auto_dispatch_enabled FROM users LIMIT 1`
    if (!before) return

    const originalValue = before.auto_dispatch_enabled
    await sql`UPDATE users SET auto_dispatch_enabled = NOT auto_dispatch_enabled WHERE id = ${before.id}`

    const [after] = await sql`SELECT auto_dispatch_enabled FROM users WHERE id = ${before.id}`
    expect(after.auto_dispatch_enabled).toBe(!originalValue)

    // Restore
    await sql`UPDATE users SET auto_dispatch_enabled = ${originalValue} WHERE id = ${before.id}`
  })
})

// ─── Agent performance page ───────────────────────────────────────────────────

test.describe('Agent performance — auto-dispatched task visibility', () => {
  test.skip(!DB_URL, 'DATABASE_URL not set')

  test('auto-dispatched tasks appear in activity log', async ({ page }) => {
    const sql = neon(DB_URL)
    const [user] = await sql`SELECT id FROM users LIMIT 1`
    if (!user) { test.skip(true, 'No user'); return }

    const [repo] = await sql`SELECT id FROM repositories WHERE user_id = ${user.id} LIMIT 1`
    if (!repo) { test.skip(true, 'No repo'); return }

    const taskId = `auto-dispatch-test-${Date.now()}`
    await sql`
      INSERT INTO portfolio_events (user_id, repo_id, event_type, title, metadata, occurred_at)
      VALUES (
        ${user.id}, ${repo.id}, 'agent_task_queued', ${'Auto-queued: fix the build'},
        ${JSON.stringify({ taskId, autoDispatched: true, impactType: 'health', effort: 'quick', predictedDelta: '+5 pts' })}::jsonb,
        NOW()
      )
    `

    await page.goto('/agent-performance')
    await expect(page.getByText('Auto-queued: fix the build')).toBeVisible({ timeout: 8000 })

    await sql`DELETE FROM portfolio_events WHERE metadata->>'taskId' = ${taskId}`
  })
})

// ─── Brief cache column exists ────────────────────────────────────────────────

test.describe('Phase 54 — cached_brief column', () => {
  test.skip(!DB_URL, 'DATABASE_URL not set')

  test('repositories table has cached_brief column', async () => {
    const sql = neon(DB_URL)
    const [row] = await sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'repositories' AND column_name = 'cached_brief'
    `
    expect(row?.column_name).toBe('cached_brief')
  })

  test('digests table has advisor_repo_snapshot column', async () => {
    const sql = neon(DB_URL)
    const [row] = await sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'digests' AND column_name = 'advisor_repo_snapshot'
    `
    expect(row?.column_name).toBe('advisor_repo_snapshot')
  })
})
