import { test, expect } from '@playwright/test'

test.describe('Graveyard page', () => {
  test('loads the graveyard page', async ({ page }) => {
    await page.goto('/repos/graveyard')
    await expect(page.getByRole('heading', { name: 'Idea Graveyard', exact: true })).toBeVisible()
  })

  test('shows repo count or empty state', async ({ page }) => {
    await page.goto('/repos/graveyard')
    // Either shows a repo count line or the empty state
    const hasRepos = await page.locator('text=repos shelved').isVisible().catch(() => false)
    const isEmpty = await page.locator('text=No repos marked as Sunsetting or Archived yet').isVisible().catch(() => false)
    expect(hasRepos || isEmpty).toBe(true)
  })

  test('has back link to repositories', async ({ page }) => {
    await page.goto('/repos/graveyard')
    await expect(page.getByRole('link', { name: '← Back to all repos' })).toBeVisible()
  })

  test('unauthenticated users are redirected to login', async ({ browser }) => {
    const context = await browser.newContext({ storageState: undefined })
    const page = await context.newPage()
    await page.goto('/repos/graveyard')
    await expect(page).toHaveURL(/\/login/)
    await context.close()
  })
})
