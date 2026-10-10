/**
 * The Agents page's Activity Log shows the factory's own record (agent_attempt events), not only
 * Nexus-era request events. Before 2026-10-10 it read only the latter, so a night of factory work
 * left it showing nothing newer than 2026-10-07. Read-only: it uses whatever attempts exist.
 */
import { test, expect } from '@playwright/test'
import { neon } from '@neondatabase/serverless'

const DB_URL = process.env.DATABASE_URL ?? ''

test('Activity Log lists the newest factory attempt with its outcome', async ({ page }, testInfo) => {
  test.skip(!DB_URL, 'needs DATABASE_URL')
  const sql = neon(DB_URL)
  const [user] = await sql`SELECT id FROM users ORDER BY last_synced_at DESC NULLS LAST LIMIT 1`
  const [latest] = await sql`
    SELECT title, metadata->>'outcome' AS outcome, metadata->>'prUrl' AS pr_url
    FROM portfolio_events
    WHERE user_id = ${user.id} AND event_type = 'agent_attempt'
    ORDER BY occurred_at DESC LIMIT 1
  `
  test.skip(!latest, 'no factory attempts recorded for this user')

  await page.goto('/agent-performance')
  await expect(page.getByRole('heading', { name: 'Activity Log' })).toBeVisible({ timeout: 10_000 })
  const badge = latest.outcome === 'success' ? (latest.pr_url ? 'PR Opened' : 'Verified') : 'Rejected'
  // The row is the smallest element holding both the attempt's title and its outcome badge.
  const row = page.locator('div')
    .filter({ has: page.getByText(latest.title as string, { exact: true }) })
    .filter({ has: page.getByText(new RegExp(`^${badge}`)) })
    .last()
  await expect(row).toBeVisible()
  // Every factory PR gets its own row: the same title on another repo must not collapse into it.
  const prs = await sql`
    SELECT DISTINCT metadata->>'prUrl' AS url FROM portfolio_events
    WHERE user_id = ${user.id} AND event_type = 'agent_attempt' AND metadata->>'prUrl' IS NOT NULL
      AND occurred_at > (SELECT max(occurred_at) FROM portfolio_events WHERE user_id = ${user.id} AND event_type = 'agent_attempt') - INTERVAL '24 hours'
  `
  for (const { url } of prs) await expect(page.locator(`a[href="${url}"]`)).toHaveCount(1)
  await testInfo.attach('activity-log-row', { body: await row.screenshot(), contentType: 'image/png' })
})
