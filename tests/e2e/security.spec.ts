import { test, expect } from '@playwright/test'

test.describe('Security page', () => {
  test('loads the security page', async ({ page }) => {
    await page.goto('/security')
    await expect(page.getByRole('heading', { name: 'Security' })).toBeVisible()
    await expect(page.getByText(/Open Dependabot and secret-scanning alerts, by repo/)).toBeVisible()
  })

  test('shows severity metric cards', async ({ page }) => {
    await page.goto('/security')
    for (const label of ['Critical', 'High', 'Medium', 'Low']) {
      await expect(page.getByText(label).first()).toBeVisible()
    }
  })

  test('shows alerts by repo, or the empty state', async ({ page }) => {
    await page.goto('/security')
    // Auto-waiting: an immediate isVisible() ran before the page streamed in and flaked.
    await expect(page.getByRole('heading', { name: /Repos in use/ }).or(page.getByText('No open security alerts.')).first()).toBeVisible({ timeout: 8000 })
  })

  test('each repo row links to the repo and to its alerts on GitHub, and the page stays small', async ({ page, request }) => {
    await page.goto('/security')
    const empty = await page.getByText('No open security alerts.').isVisible()
    test.skip(empty, 'no open alerts in this database')
    const firstRow = page.locator('section[aria-labelledby="sec-active"] li').first()
      .or(page.locator('details li').first())
    await expect(firstRow.getByRole('link', { name: 'On GitHub' })).toHaveAttribute('href', /^https:\/\/github\.com\/[^/]+\/[^/]+\/security\/dependabot$/)
    // The page used to render every alert (8 MB); a summary per repo is a small fraction of that.
    const html = await (await request.get('/security')).text()
    expect(html.length).toBeLessThan(1_500_000)
  })
})
