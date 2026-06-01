import { test, expect } from '@playwright/test'

test.describe('Feed page', () => {
  test('loads the feed page', async ({ page }) => {
    await page.goto('/feed')
    await expect(page.getByRole('heading', { name: 'Portfolio Feed', exact: true })).toBeVisible()
  })

  test('shows Feed and Milestones tabs', async ({ page }) => {
    await page.goto('/feed')
    // Scope to the tab switcher in main, not the sidebar nav link
    const main = page.locator('main, [role="main"], .space-y-4').first()
    await expect(main.getByRole('link', { name: 'Feed', exact: true })).toBeVisible()
    await expect(main.getByRole('link', { name: 'Milestones', exact: true })).toBeVisible()
  })

  test('Feed tab shows events or all-clear message', async ({ page }) => {
    await page.goto('/feed')
    const hasEvents = await page.locator('[class*="border-l-4"]').first().isVisible().catch(() => false)
    const allClear  = await page.getByText('All clear').isVisible().catch(() => false)
    expect(hasEvents || allClear).toBe(true)
  })

  test('Milestones tab loads', async ({ page }) => {
    await page.goto('/feed?tab=milestones')
    await expect(page.getByRole('button', { name: /Add milestone/i })).toBeVisible()
  })

  test('unauthenticated users are redirected to login', async ({ browser }) => {
    const context = await browser.newContext({ storageState: undefined })
    const page = await context.newPage()
    await page.goto('/feed')
    await expect(page).toHaveURL(/\/login/)
    await context.close()
  })
})
