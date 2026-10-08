import { test, expect } from '@playwright/test'

test.describe('Dashboard', () => {
  test('loads and shows metric cards', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Portfolio Dashboard' })).toBeVisible()

    // Metric card titles live in CardTitle elements
    for (const label of ['Total Repos', 'Private', 'Public', 'Healthy', 'At Risk', 'Dead', 'Security Issues', 'Avg Health']) {
      await expect(page.getByText(label, { exact: true }).first()).toBeVisible()
    }
  })

  test('shows repo count after sync', async ({ page }) => {
    await page.goto('/')
    const totalCard = page.locator('text=Total Repos').locator('..').locator('..')
    // metric-value is the CSS class used for the large number
    const value = await totalCard.locator('.metric-value').textContent()
    expect(Number(value)).toBeGreaterThanOrEqual(0)
  })

  test('sidebar navigation is present', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('link', { name: 'Dashboard', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Repositories', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Security', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Deployments', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Analytics', exact: true })).toBeVisible()
  })

  test('sync button is visible in topbar', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('button', { name: /Sync/i })).toBeVisible()
  })

  test('shows Top Repositories section', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Top Repositories')).toBeVisible()
    await expect(page.getByRole('link', { name: 'View all →' })).toBeVisible()
  })

  test('Needs you: what to do next and the open PR queue lead the page', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Needs you', { exact: true })).toBeVisible()
    await expect(page.getByText(/deserve attention|Nothing needs you today/).first()).toBeVisible()
    await expect(page.getByText(/open PRs? waiting for you|No open PRs|Couldn.t list open PRs/).first()).toBeVisible()
  })

  test('unused insights are collapsed under More insights', async ({ page }) => {
    await page.goto('/')
    const toggle = page.getByRole('button', { name: /More insights section/ })
    await expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByText('Plan My Week', { exact: true })).toHaveCount(0)
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByText('Plan My Week', { exact: true })).toBeVisible()
    await page.evaluate(() => localStorage.removeItem('dashboard-more-insights-open'))
  })

  test('unauthenticated users are redirected to login', async ({ browser }) => {
    const context = await browser.newContext({ storageState: undefined })
    const page = await context.newPage()
    await page.goto('/')
    await expect(page).toHaveURL(/\/login/)
    await context.close()
  })
})
