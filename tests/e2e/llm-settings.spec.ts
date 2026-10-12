import { test, expect } from '@playwright/test'

test.describe('Settings — AI Provider', () => {
  test('shows the AI Provider card', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByText('AI provider', { exact: true })).toBeVisible()
  })

  test('shows every provider, with the paid ones off ($0 by default)', async ({ page }) => {
    await page.goto('/settings')
    for (const name of ['Gemini (Google)', 'OpenRouter (free models)']) {
      await expect(page.getByRole('button').filter({ hasText: name })).toBeEnabled()
    }
    for (const name of ['Claude (Anthropic)', 'GPT-4o (OpenAI)']) {
      const button = page.getByRole('button').filter({ hasText: name })
      await expect(button).toBeDisabled()
      await expect(button.getByText('paid · off')).toBeVisible()
    }
  })

  // One of the key states is always shown, or, when the chosen provider is paid and off, the line
  // saying which provider AI calls use instead. Wait for it (an immediate isVisible() ran before the
  // card rendered and read every state as absent).
  const keyStatus = /Your key active|App key active|No key|AI features use|AI features are off/

  test('shows key status badge', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByText(keyStatus).first()).toBeVisible({ timeout: 8000 })
  })

  test('shows key input form when no user key is configured', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByText(keyStatus).first()).toBeVisible({ timeout: 8000 })
    const hasUserKey = await page.getByText('Your key active').isVisible()
    const locked = await page.getByText(/is a paid API, and RepoHQ runs at \$0/).isVisible()
    if (!hasUserKey && !locked) {
      // Should show the key input and save button
      await expect(page.getByRole('button', { name: /Save & verify/i })).toBeVisible()
    }
  })

  test('shows Save & verify button and key input', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByText(keyStatus).first()).toBeVisible({ timeout: 8000 })
    const hasUserKey = await page.getByText('Your key active').isVisible()
    const locked = await page.getByText(/is a paid API, and RepoHQ runs at \$0/).isVisible()
    if (!hasUserKey && !locked) {
      const input = page.locator('input[type="password"]').first()
      await expect(input).toBeVisible()
      await expect(page.getByRole('button', { name: /Save & verify/i })).toBeVisible()
    }
  })

  test('provider buttons are clickable', async ({ page }) => {
    await page.goto('/settings')
    // Clicking a free provider shows its hint
    const geminiBtn = page.getByRole('button').filter({ hasText: 'Gemini (Google)' })
    await geminiBtn.click()
    await expect(page.getByText(/aistudio.google.com/)).toBeVisible()
  })

  test('unauthenticated users cannot access settings', async ({ browser }) => {
    const context = await browser.newContext({ storageState: undefined })
    const page = await context.newPage()
    await page.goto('/settings')
    await expect(page).toHaveURL(/\/login/)
    await context.close()
  })
})
