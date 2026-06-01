import { test, expect } from '@playwright/test'

test.describe('Settings — AI Provider', () => {
  test('shows the AI Provider card', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByText('AI Provider')).toBeVisible()
  })

  test('shows all three provider options', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByText('Claude (Anthropic)')).toBeVisible()
    await expect(page.getByText('GPT-4o (OpenAI)')).toBeVisible()
    await expect(page.getByText('Gemini (Google)')).toBeVisible()
  })

  test('shows key status badge', async ({ page }) => {
    await page.goto('/settings')
    // One of these three states is always shown
    const hasUserKey = await page.getByText('Your key active').isVisible().catch(() => false)
    const hasEnvKey  = await page.getByText('App key active').isVisible().catch(() => false)
    const noKey      = await page.getByText('No key').isVisible().catch(() => false)
    expect(hasUserKey || hasEnvKey || noKey).toBe(true)
  })

  test('shows key input form when no user key is configured', async ({ page }) => {
    await page.goto('/settings')
    const hasUserKey = await page.getByText('Your key active').isVisible().catch(() => false)
    if (!hasUserKey) {
      // Should show the key input and save button
      await expect(page.getByRole('button', { name: /Save & verify/i })).toBeVisible()
    }
  })

  test('shows Save & verify button and key input', async ({ page }) => {
    await page.goto('/settings')
    const hasUserKey = await page.getByText('Your key active').isVisible().catch(() => false)
    if (!hasUserKey) {
      const input = page.locator('input[type="password"]').first()
      await expect(input).toBeVisible()
      await expect(page.getByRole('button', { name: /Save & verify/i })).toBeVisible()
    }
  })

  test('provider buttons are clickable', async ({ page }) => {
    await page.goto('/settings')
    // Clicking OpenAI should not throw
    const openaiBtn = page.getByRole('button').filter({ hasText: 'GPT-4o (OpenAI)' })
    if (await openaiBtn.isVisible()) {
      await openaiBtn.click()
      // After clicking, the hint text for OpenAI should be visible
      await expect(page.getByText(/platform.openai.com/)).toBeVisible()
    }
  })

  test('unauthenticated users cannot access settings', async ({ browser }) => {
    const context = await browser.newContext({ storageState: undefined })
    const page = await context.newPage()
    await page.goto('/settings')
    await expect(page).toHaveURL(/\/login/)
    await context.close()
  })
})
