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
  await sql`UPDATE users SET llm_provider = 'anthropic', llm_keys = '{}'::jsonb, llm_api_key = NULL`
}

async function getDBState() {
  if (!DB_URL) return null
  const sql = neon(DB_URL)
  const [row] = await sql`
    SELECT llm_provider,
           llm_keys,
           llm_keys->>'openai' IS NOT NULL AS has_openai_key
    FROM users LIMIT 1`
  return row as { llm_provider: string; llm_keys: Record<string, string>; has_openai_key: boolean }
}

test.describe('OpenAI key persistence', () => {
  test.beforeEach(async () => { await resetLLMSettings() })

  test('key shows as active immediately after save', async ({ page }) => {
    test.skip(!OPENAI_KEY, 'OPENAI_API_KEY not in .env.local')

    await page.goto('/settings')
    await page.getByRole('button').filter({ hasText: 'GPT-4o (OpenAI)' }).click()
    const input = page.locator('input[type="password"]').first()
    await expect(input).toBeVisible({ timeout: 5000 })
    await input.fill(OPENAI_KEY)
    await page.getByRole('button', { name: /Save & verify/i }).click()
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

    const state = await getDBState()
    expect(state?.llm_provider).toBe('openai')
    expect(state?.has_openai_key).toBe(true)
  })

  test('key persists after navigating away and back', async ({ page }) => {
    test.skip(!OPENAI_KEY, 'OPENAI_API_KEY not in .env.local')

    await page.goto('/settings')
    await page.getByRole('button').filter({ hasText: 'GPT-4o (OpenAI)' }).click()
    const input = page.locator('input[type="password"]').first()
    await expect(input).toBeVisible()
    await input.fill(OPENAI_KEY)
    await page.getByRole('button', { name: /Save & verify/i }).click()
    await expect(page.getByText('Your key active')).toBeVisible({ timeout: 30000 })

    await page.goto('/')
    await page.goto('/settings')

    await expect(page.getByText('Your key active')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('input[type="password"]')).not.toBeVisible()
  })

  test('key persists after hard page reload', async ({ page }) => {
    test.skip(!OPENAI_KEY, 'OPENAI_API_KEY not in .env.local')

    await page.goto('/settings')
    await page.getByRole('button').filter({ hasText: 'GPT-4o (OpenAI)' }).click()
    const input = page.locator('input[type="password"]').first()
    await expect(input).toBeVisible()
    await input.fill(OPENAI_KEY)
    await page.getByRole('button', { name: /Save & verify/i }).click()
    await expect(page.getByText('Your key active')).toBeVisible({ timeout: 30000 })

    await page.reload()

    await expect(page.getByText('Your key active')).toBeVisible({ timeout: 10000 })
  })

  // ── Tab-switch regression test ──────────────────────────────────────────
  // Clicking a different provider tab called setLLMProvider which wiped
  // llmApiKey=null, destroying the saved key. This test locks that fix.

  test('key survives switching to Anthropic tab and back', async ({ page }) => {
    test.skip(!OPENAI_KEY, 'OPENAI_API_KEY not in .env.local')

    // 1. Save OpenAI key
    await page.goto('/settings')
    await page.getByRole('button').filter({ hasText: 'GPT-4o (OpenAI)' }).click()
    const input = page.locator('input[type="password"]').first()
    await expect(input).toBeVisible()
    await input.fill(OPENAI_KEY)
    await page.getByRole('button', { name: /Save & verify/i }).click()
    await expect(page.getByText('Your key active')).toBeVisible({ timeout: 30000 })

    // 2. Click Anthropic tab — this used to call setLLMProvider('anthropic')
    //    which set llmApiKey=null, wiping the OpenAI key
    await page.getByRole('button').filter({ hasText: 'Claude (Anthropic)' }).click()
    await page.waitForTimeout(800)

    // 3. Click back to OpenAI
    await page.getByRole('button').filter({ hasText: 'GPT-4o (OpenAI)' }).click()
    await page.waitForTimeout(500)

    // 4. Key must still be active
    await expect(page.getByText('Your key active')).toBeVisible({ timeout: 5000 })
    await expect(page.locator('input[type="password"]')).not.toBeVisible()
  })

  test('key survives switching through all tabs and back to OpenAI', async ({ page }) => {
    test.skip(!OPENAI_KEY, 'OPENAI_API_KEY not in .env.local')

    // Save OpenAI key
    await page.goto('/settings')
    await page.getByRole('button').filter({ hasText: 'GPT-4o (OpenAI)' }).click()
    const input = page.locator('input[type="password"]').first()
    await expect(input).toBeVisible()
    await input.fill(OPENAI_KEY)
    await page.getByRole('button', { name: /Save & verify/i }).click()
    await expect(page.getByText('Your key active')).toBeVisible({ timeout: 30000 })

    // Cycle through all providers
    await page.getByRole('button').filter({ hasText: 'Claude (Anthropic)' }).click()
    await page.waitForTimeout(500)
    await page.getByRole('button').filter({ hasText: 'Gemini (Google)' }).click()
    await page.waitForTimeout(500)
    await page.getByRole('button').filter({ hasText: 'GPT-4o (OpenAI)' }).click()
    await page.waitForTimeout(500)

    // OpenAI key must still be active
    await expect(page.getByText('Your key active')).toBeVisible({ timeout: 5000 })

    // Verify DB still has the key
    const state = await getDBState()
    expect(state?.has_openai_key).toBe(true)
  })
})
