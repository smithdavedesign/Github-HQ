import { test, expect } from '@playwright/test'

test.describe('Analytics page', () => {
  test('loads the analytics page', async ({ page }) => {
    await page.goto('/analytics')
    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible()
    await expect(page.getByText('Portfolio health trends')).toBeVisible()
  })

  test('shows chart or empty state', async ({ page }) => {
    await page.goto('/analytics')
    // Recharts measures its container asynchronously — wait for network idle
    await page.waitForLoadState('networkidle')
    const hasChart = await page.locator('.recharts-wrapper').isVisible({ timeout: 3000 }).catch(() => false)
    const hasEmpty = await page.getByText('No data yet').isVisible({ timeout: 1000 }).catch(() => false)
    expect(hasChart || hasEmpty).toBe(true)
  })
})
