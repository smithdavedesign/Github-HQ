/**
 * LLM key persistence tests.
 * Uses OPENAI_API_KEY from .env.local to run real save/verify cycles.
 */
import { test, expect } from '@playwright/test'
import { neon } from '@neondatabase/serverless'

const OPENAI_KEY = process.env.OPENAI_API_KEY ?? ''
const DB_URL     = process.env.DATABASE_URL ?? ''

async function resetLLMSettings() {
  if (!DB_URL) return
  const sql = neon(DB_URL)
  await sql`UPDATE users SET llm_provider = 'anthropic', llm_api_key = NULL`
}

async function getDBState() {
  if (!DB_URL) return null
  const sql = neon(DB_URL)
  const [row] = await sql`
    SELECT llm_provider,
           CASE WHEN llm_api_key IS NULL THEN false ELSE true END AS has_key,
           LEFT(llm_api_key, 8) AS key_prefix
    FROM users LIMIT 1`
  return row
}

test.describe('OpenAI key persistence', () => {
  test.beforeEach(async () => {
    await resetLLMSettings()
  })

  test('key shows as active immediately after save', async ({ page }) => {
    test.skip(!OPENAI_KEY, 'OPENAI_API_KEY not in .env.local')

    await page.goto('/settings')

    // Select OpenAI
    await page.getByRole('button').filter({ hasText: 'GPT-4o (OpenAI)' }).click()
    const input = page.locator('input[type="password"]').first()
    await expect(input).toBeVisible({ timeout: 5000 })

    await input.fill(OPENAI_KEY)
    await page.getByRole('button', { name: /Save & verify/i }).click()

    // Should show "Your key active" within 30s (API validation takes time)
    await expect(page.getByText('Your key active')).toBeVisible({ timeout: 30000 })
  })

  test('DB is updated correctly after save', async ({ page }) => {
    test.skip(!OPENAI_KEY || !DB_URL, 'env vars not set')

    await page.goto('/settings')
    await page.getByRole('button').filter({ hasText: 'GPT-4o (OpenAI)' }).click()
    const input = page.locator('input[type="password"]').first()
    await expect(input).toBeVisible()
    await input.fill(OPENAI_KEY)
    await page.getByRole('button', { name: /Save & verify/i }).click()
    await expect(page.getByText('Your key active')).toBeVisible({ timeout: 30000 })

    // Verify DB was actually written
    const state = await getDBState()
    expect(state?.llm_provider).toBe('openai')
    expect(state?.has_key).toBe(true)
  })

  test('key persists after navigating away and back', async ({ page }) => {
    test.skip(!OPENAI_KEY, 'OPENAI_API_KEY not in .env.local')

    // Save the key
    await page.goto('/settings')
    await page.getByRole('button').filter({ hasText: 'GPT-4o (OpenAI)' }).click()
    const input = page.locator('input[type="password"]').first()
    await expect(input).toBeVisible()
    await input.fill(OPENAI_KEY)
    await page.getByRole('button', { name: /Save & verify/i }).click()
    await expect(page.getByText('Your key active')).toBeVisible({ timeout: 30000 })

    // Navigate away
    await page.goto('/')
    await page.waitForURL('**/')

    // Navigate back to settings
    await page.goto('/settings')
    await page.waitForURL('**/settings')

    // THE KEY ASSERTION — this is what currently fails
    await expect(page.getByText('Your key active')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('input[type="password"]')).not.toBeVisible()
  })

  test('key persists after hard page reload (full server render)', async ({ page }) => {
    test.skip(!OPENAI_KEY, 'OPENAI_API_KEY not in .env.local')

    await page.goto('/settings')
    await page.getByRole('button').filter({ hasText: 'GPT-4o (OpenAI)' }).click()
    const input = page.locator('input[type="password"]').first()
    await expect(input).toBeVisible()
    await input.fill(OPENAI_KEY)
    await page.getByRole('button', { name: /Save & verify/i }).click()
    await expect(page.getByText('Your key active')).toBeVisible({ timeout: 30000 })

    // Full page reload — bypasses all Next.js router cache
    await page.reload()
    await page.waitForURL('**/settings')

    await expect(page.getByText('Your key active')).toBeVisible({ timeout: 10000 })
  })
})
