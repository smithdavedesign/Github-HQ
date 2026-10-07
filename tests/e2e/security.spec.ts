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
    // Auto-waiting: an immediate isVisible() ran before the page streamed in and flaked.
    await expect(page.locator('table').or(page.getByText('No open security findings')).first()).toBeVisible({ timeout: 8000 })
  })
})
