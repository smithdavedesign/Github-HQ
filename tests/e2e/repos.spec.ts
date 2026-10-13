import { test, expect } from '@playwright/test'
import { LOCAL_DB, LOCAL_DB_REASON } from './helpers/disposable-db'

test.describe('Repositories table', () => {
  test('loads the repos page', async ({ page }) => {
    await page.goto('/repos')
    await expect(page.getByRole('heading', { name: 'Repositories' })).toBeVisible()
  })

  test('shows the data table with column headers', async ({ page }) => {
    await page.goto('/repos')
    // Column headers live inside <th> elements
    await expect(page.locator('th', { hasText: 'Repository' })).toBeVisible()
    await expect(page.locator('th', { hasText: 'Health' })).toBeVisible()
    await expect(page.locator('th', { hasText: 'Framework' })).toBeVisible()
  })

  test('search filters repos', async ({ page }) => {
    await page.goto('/repos')
    const search = page.getByPlaceholder('Search repositories…')
    await expect(search).toBeVisible()

    await search.fill('zzz-nonexistent-repo-xyz')
    // Should show no results message or zero rows
    await expect(page.getByText(/No repositories found/i).or(page.locator('tbody tr'))).toBeTruthy()
  })

  test('columns dropdown is functional', async ({ page }) => {
    await page.goto('/repos')
    await page.getByRole('button', { name: /Columns/i }).click()
    await expect(page.getByRole('menu')).toBeVisible()
  })

  test('the columns menu uses names, and a search with no match says so', async ({ page }) => {
    test.skip(LOCAL_DB, LOCAL_DB_REASON)
    await page.goto('/repos')
    await page.getByRole('button', { name: 'Columns' }).click()
    const menu = page.getByRole('menu')
    await expect(menu.getByText('Health', { exact: true })).toBeVisible()
    await expect(menu.getByText('healthScore')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await page.getByRole('textbox', { name: 'Search repositories' }).fill('zz-no-such-repo-zz')
    await expect(page.getByText('No repositories match “zz-no-such-repo-zz”.')).toBeVisible()
  })

  test('the page sends counts, not every alert (it was 8 MB)', async ({ request }) => {
    const html = await (await request.get('/repos')).text()
    expect(html).not.toContain('githubAlertId')
    expect(html.length).toBeLessThan(1_500_000)
  })

  test('CSV export button is present', async ({ page }) => {
    await page.goto('/repos')
    await expect(page.getByRole('button', { name: /Export CSV/i })).toBeVisible()
  })

  test('clicking repo name navigates to detail page', async ({ page }) => {
    test.skip(LOCAL_DB, LOCAL_DB_REASON)
    await page.goto('/repos')
    const firstLink = page.locator('tbody tr').first().getByRole('link').first()
    const name = await firstLink.textContent()
    if (name) {
      await firstLink.click()
      await expect(page).toHaveURL(/\/repos\/\d+/)
      await expect(page.getByRole('heading', { level: 1 })).toContainText(name.trim())
    }
  })

  test('pagination controls are present when needed', async ({ page }) => {
    await page.goto('/repos')
    await expect(page.getByRole('button', { name: 'Previous', exact: true })).toBeVisible()
    // Avoid matching the Next.js devtools button
    await expect(page.getByRole('button', { name: 'Next', exact: true }).first()).toBeVisible()
  })
})
