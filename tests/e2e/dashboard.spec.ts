import { test, expect } from '@playwright/test'
import { LOCAL_DB, LOCAL_DB_REASON } from './helpers/disposable-db'

test.describe('Dashboard', () => {
  test('loads and shows metric cards', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Portfolio Dashboard' })).toBeVisible()

    // Metric card titles live in CardTitle elements
    for (const label of ['Total Repos', 'Private', 'Public', 'Healthy', 'At Risk', 'Low health', 'Security Issues', 'Avg Health']) {
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

  test('sidebar: four primary pages, a More group, and Triage/Graveyard on Repositories', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    const nav = page.getByRole('navigation', { name: 'Main' })
    for (const label of ['Dashboard', 'Repositories', 'Agents', 'Security', 'Deployments', 'Analytics', 'Feed']) {
      await expect(nav.getByRole('link', { name: label, exact: true })).toBeVisible()
    }
    await expect(nav.getByText('More', { exact: true })).toBeVisible()
    await expect(nav.getByRole('link', { name: 'Graveyard' })).toHaveCount(0)
    await page.goto('/repos')
    await expect(page.locator('main').getByRole('link', { name: /^Triage/ })).toBeVisible()
    await page.locator('main').getByRole('link', { name: /^Graveyard/ }).click()
    await expect(page).toHaveURL(/\/repos\/graveyard/)
    await expect(nav.getByRole('link', { name: 'Repositories', exact: true })).toHaveAttribute('aria-current', 'page')
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
    test.skip(LOCAL_DB, LOCAL_DB_REASON)
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

test.describe('Open PRs card layout', () => {
  // Fixed table layout: a column's width includes its padding. The Age column once had 32px for
  // "today" and was cut off at the card's edge; long titles once pushed it out on a phone.
  for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]] as const) {
    test(`every PR's age fits inside the card (${label})`, async ({ page }) => {
      test.skip(LOCAL_DB, LOCAL_DB_REASON)
      await page.setViewportSize(viewport)
      await page.goto('/')
      const card = page.getByTestId('open-prs')
      await expect(card).toBeVisible({ timeout: 15000 })
      const rows = card.locator('tbody tr')
      test.skip((await rows.count()) === 0, 'no open PRs right now')
      const cardBox = (await card.boundingBox())!
      for (const cell of await rows.locator('td:last-child').all()) {
        const fits = await cell.evaluate(el => el.scrollWidth <= el.clientWidth)
        expect(fits, `age text overflows its column: "${await cell.innerText()}"`).toBe(true)
        const box = (await cell.boundingBox())!
        expect(box.x + box.width).toBeLessThanOrEqual(cardBox.x + cardBox.width + 1)
      }
    })
  }
})
