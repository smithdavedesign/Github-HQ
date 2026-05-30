import { test, expect } from '@playwright/test'

test.describe('Security page', () => {
  test('loads the security page', async ({ page }) => {
    await page.goto('/security')
    await expect(page.getByRole('heading', { name: 'Security' })).toBeVisible()
    await expect(page.getByText('Dependabot alerts and secret scanning')).toBeVisible()
  })

  test('shows severity metric cards', async ({ page }) => {
    await page.goto('/security')
    for (const label of ['Critical', 'High', 'Medium', 'Low']) {
      await expect(page.getByText(label).first()).toBeVisible()
    }
  })

  test('shows table or empty state', async ({ page }) => {
    await page.goto('/security')
    const hasTable = await page.locator('table').isVisible().catch(() => false)
    const hasEmpty = await page.locator('text=No open security findings').isVisible().catch(() => false)
    expect(hasTable || hasEmpty).toBe(true)
  })
})
