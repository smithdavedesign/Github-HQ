/**
 * Phase 50 + 51 — MCP active work & attempt log E2E tests.
 *
 * Covers Agent History tab showing attempt events, and that the Agent tab
 * is present on repo detail pages.
 */
import { test, expect } from '@playwright/test'
import { neon } from '@neondatabase/serverless'

const DB_URL = process.env.DATABASE_URL ?? ''

test.describe('Agent History tab — attempt events (Phase 51)', () => {
  test('Agent tab is present on repo detail page', async ({ page }) => {
    await page.goto('/repos')
    // Click first repo link
    const firstRepo = page.getByRole('link', { name: /^[A-Za-z]/ }).first()
    if (!await firstRepo.isVisible()) return
    await firstRepo.click()
    await expect(page.getByRole('tab', { name: /Agent/i })).toBeVisible({ timeout: 8000 })
  })

  test('agent_attempt events appear in Agent History tab', async ({ page }) => {
    test.skip(!DB_URL, 'DATABASE_URL not set')

    const sql = neon(DB_URL)
    const [user] = await sql`SELECT id FROM users LIMIT 1`
    if (!user) test.skip(true, 'No user')

    const [repo] = await sql`SELECT id FROM repositories WHERE user_id = ${user.id} LIMIT 1`
    if (!repo) test.skip(true, 'No repo')

    const attemptTitle = `❌ Attempt: add unit tests — playwright test ${Date.now()}`
    await sql`
      INSERT INTO portfolio_events (user_id, repo_id, event_type, title, metadata, occurred_at)
      VALUES (
        ${user.id}, ${repo.id}, 'agent_attempt', ${attemptTitle},
        ${JSON.stringify({ action: 'add unit tests', outcome: 'failed', reason: 'playwright test' })}::jsonb,
        NOW()
      )
    `

    await page.goto(`/repos/${repo.id}`)
    await page.getByRole('tab', { name: /Agent/i }).click()
    await expect(page.getByText(/add unit tests/i)).toBeVisible({ timeout: 5000 })

    // Cleanup
    await sql`DELETE FROM portfolio_events WHERE title = ${attemptTitle}`
  })

  test('Agent tab shows empty state when no agent activity', async ({ page }) => {
    test.skip(!DB_URL, 'DATABASE_URL not set')

    const sql = neon(DB_URL)
    const [user] = await sql`SELECT id FROM users LIMIT 1`
    if (!user) test.skip(true, 'No user')

    // Find a repo with no agent events
    const [repo] = await sql`
      SELECT r.id FROM repositories r
      WHERE r.user_id = ${user.id}
        AND NOT EXISTS (
          SELECT 1 FROM portfolio_events pe
          WHERE pe.repo_id = r.id
            AND pe.event_type IN ('agent_task_queued','agent_pr_created','agent_pr_merged','agent_execution_failed','agent_attempt')
        )
      LIMIT 1
    `
    if (!repo) test.skip(true, 'No repo without agent events')

    await page.goto(`/repos/${repo.id}`)
    await page.getByRole('tab', { name: /Agent/i }).click()
    await expect(page.getByText('No agent activity yet')).toBeVisible({ timeout: 5000 })
  })
})

test.describe('Phase 50 — active work signal in MCP (API-level)', () => {
  // MCP runs as a stdio server, not HTTP, so we test the UI surface:
  // the repo list "PR open" badge that relies on the same open-PR detection

  test('repos page loads without error', async ({ page }) => {
    await page.goto('/repos')
    await expect(page.getByText('Repositories')).toBeVisible({ timeout: 8000 })
  })

  test('PR open badge appears when seeded', async ({ page }) => {
    test.skip(!DB_URL, 'DATABASE_URL not set')

    const sql = neon(DB_URL)
    const [user] = await sql`SELECT id FROM users LIMIT 1`
    if (!user) test.skip(true, 'No user')

    const [repo] = await sql`SELECT id, name FROM repositories WHERE user_id = ${user.id} LIMIT 1`
    if (!repo) test.skip(true, 'No repo')

    const taskId = `playwright-active-work-${Date.now()}`
    await sql`
      INSERT INTO portfolio_events (user_id, repo_id, event_type, title, metadata, occurred_at)
      VALUES (
        ${user.id}, ${repo.id}, 'agent_pr_created', 'Playwright PR test',
        ${JSON.stringify({ taskId, prUrl: 'https://github.com/test/repo/pull/99' })}::jsonb,
        NOW()
      )
    `

    await page.goto('/repos')
    await expect(page.getByText('PR open')).toBeVisible({ timeout: 8000 })

    // Cleanup
    await sql`DELETE FROM portfolio_events WHERE metadata->>'taskId' = ${taskId}`
  })
})
