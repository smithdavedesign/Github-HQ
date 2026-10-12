/**
 * LLM key persistence tests.
 * Uses GEMINI_API_KEY from .env.local (the free tier) to run real save/verify cycles: RepoHQ's AI is
 * $0 by default, and these used to spend OpenAI credit on every run.
 */
import { test, expect } from '@playwright/test'
import { neon } from '@neondatabase/serverless'
import { DISPOSABLE_DB, DISPOSABLE_DB_REASON } from './helpers/disposable-db'


// Overwrites every user's LLM settings.
test.skip(!DISPOSABLE_DB, DISPOSABLE_DB_REASON)

const GEMINI_KEY = process.env.GEMINI_API_KEY ?? ''
const DB_URL     = process.env.DATABASE_URL ?? ''

async function resetLLMSettings() {
  if (!DB_URL) return
  const sql = neon(DB_URL)
  await sql`UPDATE users SET llm_provider = 'openrouter', llm_keys = '{}'::jsonb, llm_api_key = NULL`
}

async function getDBState() {
  if (!DB_URL) return null
  const sql = neon(DB_URL)
  const [row] = await sql`
    SELECT llm_provider,
           llm_keys,
           llm_keys->>'gemini' IS NOT NULL AS has_gemini_key
    FROM users ORDER BY last_synced_at DESC NULLS LAST LIMIT 1`
  return row as { llm_provider: string; llm_keys: Record<string, string>; has_gemini_key: boolean }
}

test.describe('Gemini key persistence', () => {
  test.beforeEach(async () => { await resetLLMSettings() })

  test('key shows as active immediately after save', async ({ page }) => {
    test.skip(!GEMINI_KEY, 'GEMINI_API_KEY not in .env.local')

    await page.goto('/settings')
    await page.getByRole('button').filter({ hasText: 'Gemini (Google)' }).click()
    const input = page.locator('input[type="password"]').first()
    await expect(input).toBeVisible({ timeout: 5000 })
    await input.fill(GEMINI_KEY)
    await page.getByRole('button', { name: /Save & verify/i }).click()
    await expect(page.getByText('Your key active')).toBeVisible({ timeout: 30000 })
  })

  test('DB is updated correctly after save', async ({ page }) => {
    test.skip(!GEMINI_KEY || !DB_URL, 'env vars not set')

    await page.goto('/settings')
    await page.getByRole('button').filter({ hasText: 'Gemini (Google)' }).click()
    const input = page.locator('input[type="password"]').first()
    await expect(input).toBeVisible()
    await input.fill(GEMINI_KEY)
    await page.getByRole('button', { name: /Save & verify/i }).click()
    await expect(page.getByText('Your key active')).toBeVisible({ timeout: 30000 })

    const state = await getDBState()
    expect(state?.llm_provider).toBe('gemini')
    expect(state?.has_gemini_key).toBe(true)
  })

  test('key persists after navigating away and back', async ({ page }) => {
    test.skip(!GEMINI_KEY, 'GEMINI_API_KEY not in .env.local')

    await page.goto('/settings')
    await page.getByRole('button').filter({ hasText: 'Gemini (Google)' }).click()
    const input = page.locator('input[type="password"]').first()
    await expect(input).toBeVisible()
    await input.fill(GEMINI_KEY)
    await page.getByRole('button', { name: /Save & verify/i }).click()
    await expect(page.getByText('Your key active')).toBeVisible({ timeout: 30000 })

    await page.goto('/')
    await page.goto('/settings')

    await expect(page.getByText('Your key active')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('input[type="password"]')).not.toBeVisible()
  })

  test('key persists after hard page reload', async ({ page }) => {
    test.skip(!GEMINI_KEY, 'GEMINI_API_KEY not in .env.local')

    await page.goto('/settings')
    await page.getByRole('button').filter({ hasText: 'Gemini (Google)' }).click()
    const input = page.locator('input[type="password"]').first()
    await expect(input).toBeVisible()
    await input.fill(GEMINI_KEY)
    await page.getByRole('button', { name: /Save & verify/i }).click()
    await expect(page.getByText('Your key active')).toBeVisible({ timeout: 30000 })

    await page.reload()

    await expect(page.getByText('Your key active')).toBeVisible({ timeout: 10000 })
  })

  // ── Tab-switch regression test ──────────────────────────────────────────
  // Clicking a different provider tab called setLLMProvider which wiped
  // llmApiKey=null, destroying the saved key. This test locks that fix.

  test('key survives switching to another provider and back', async ({ page }) => {
    test.skip(!GEMINI_KEY, 'GEMINI_API_KEY not in .env.local')

    // 1. Save the Gemini key
    await page.goto('/settings')
    await page.getByRole('button').filter({ hasText: 'Gemini (Google)' }).click()
    const input = page.locator('input[type="password"]').first()
    await expect(input).toBeVisible()
    await input.fill(GEMINI_KEY)
    await page.getByRole('button', { name: /Save & verify/i }).click()
    await expect(page.getByText('Your key active')).toBeVisible({ timeout: 30000 })

    // 2. Click another provider — this used to call setLLMProvider(), which set llmApiKey=null and
    //    wiped the saved key
    await page.getByRole('button').filter({ hasText: 'OpenRouter (free models)' }).click()
    await page.waitForTimeout(800)

    // 3. Click back to Gemini
    await page.getByRole('button').filter({ hasText: 'Gemini (Google)' }).click()
    await page.waitForTimeout(500)

    // 4. Key must still be active
    await expect(page.getByText('Your key active')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('input[type="password"]')).not.toBeVisible()
  })

  test('key survives switching through the free providers and back', async ({ page }) => {
    test.skip(!GEMINI_KEY, 'GEMINI_API_KEY not in .env.local')

    // Save the Gemini key
    await page.goto('/settings')
    await page.getByRole('button').filter({ hasText: 'Gemini (Google)' }).click()
    const input = page.locator('input[type="password"]').first()
    await expect(input).toBeVisible()
    await input.fill(GEMINI_KEY)
    await page.getByRole('button', { name: /Save & verify/i }).click()
    await expect(page.getByText('Your key active')).toBeVisible({ timeout: 30000 })

    // Cycle through the free providers
    await page.getByRole('button').filter({ hasText: 'OpenRouter (free models)' }).click()
    await page.waitForTimeout(500)
    await page.getByRole('button').filter({ hasText: 'Gemini (Google)' }).click()
    await page.waitForTimeout(500)

    // The Gemini key must still be active
    await expect(page.getByText('Your key active')).toBeVisible({ timeout: 5000 })

    // Verify DB still has the key
    const state = await getDBState()
    expect(state?.has_gemini_key).toBe(true)
  })
})
