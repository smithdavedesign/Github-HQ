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
    const hasTable = await page.locator('table').isVisible().catch(() => false)
    const hasEmpty = await page.locator('text=No deployments configured').isVisible().catch(() => false)
    expect(hasTable || hasEmpty).toBe(true)
  })
})
