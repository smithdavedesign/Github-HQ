/**
 * The dashboard's AI Portfolio Advisor and CEO report run in the background. A failed run used to
 * leave no trace (the button said "refresh in ~30 seconds"); the card now says why it failed.
 * Seeds a failed run on the throwaway branch, so no AI provider is called.
 */
import { test, expect } from '@playwright/test'
import { neon } from '@neondatabase/serverless'
import { DISPOSABLE_DB, DISPOSABLE_DB_REASON } from './helpers/disposable-db'

const DB_URL = process.env.DATABASE_URL ?? ''
const REASON = "Advisor: OpenRouter's free daily limit is used up (50 requests a day, shared with everything else using the key). It resets at midnight UTC."

test.describe('AI runs on the dashboard', () => {
  test.skip(!DISPOSABLE_DB, DISPOSABLE_DB_REASON)

  test('a failed Advisor run shows its reason on the card', async ({ page }) => {
    const sql = neon(DB_URL)
    const [u] = await sql`SELECT id FROM users ORDER BY last_synced_at DESC NULLS LAST LIMIT 1`
    const id = `e2e-ai-run-${Date.now()}`
    await sql`INSERT INTO automation_runs (id, user_id, kind, trigger, status, error, started_at, finished_at)
      VALUES (${id}, ${u.id}, 'ai:advisor', 'manual', 'failed', ${REASON}, now(), now())`
    try {
      await page.goto('/')
      const failed = page.getByTestId('ai-run-failed').filter({ hasText: 'free daily limit' })
      await expect(failed).toBeVisible({ timeout: 15000 })
      await expect(failed).toContainText('Last run failed: Advisor: OpenRouter')
      await expect(failed).toContainText('resets at midnight UTC')
    } finally {
      await sql`DELETE FROM automation_runs WHERE id = ${id}`
    }
  })
})
