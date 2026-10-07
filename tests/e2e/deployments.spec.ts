import { test, expect } from '@playwright/test'

test.describe('Deployments page', () => {
  test('loads the deployments page', async ({ page }) => {
    await page.goto('/deployments')
    await expect(page.getByRole('heading', { name: 'Deployments' })).toBeVisible()
    await expect(page.getByText('Production URL uptime')).toBeVisible()
  })

  test('shows status metric cards', async ({ page }) => {
    await page.goto('/deployments')
    for (const label of ['Total Monitored', 'Slow', 'Down']) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible()
    }
  })

  test('shows table or empty state', async ({ page }) => {
    await page.goto('/deployments')
    // Auto-waiting: an immediate isVisible() ran before the page streamed in.
    await expect(page.locator('table').or(page.getByText('No deployments configured')).first()).toBeVisible({ timeout: 8000 })
  })
})
