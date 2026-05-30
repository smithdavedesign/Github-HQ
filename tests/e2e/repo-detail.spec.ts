import { test, expect } from '@playwright/test'
import { neon } from '@neondatabase/serverless'

test.describe('Repository detail page', () => {
  let repoId: number

  test.beforeAll(async () => {
    const sql = neon(process.env.DATABASE_URL!)
    const rows = await sql`SELECT id FROM repositories LIMIT 1`
    repoId = rows[0]?.id
  })

  test('loads repo detail page', async ({ page }) => {
    test.skip(!repoId, 'No repos in DB yet')
    await page.goto(`/repos/${repoId}`)
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  })

  test('shows all detail tabs', async ({ page }) => {
    test.skip(!repoId, 'No repos in DB yet')
    await page.goto(`/repos/${repoId}`)
    for (const tab of ['Overview', 'Tech Stack', 'Security', 'Deployments', 'AI Summary']) {
      await expect(page.getByRole('tab', { name: tab })).toBeVisible()
    }
  })

  test('overview tab shows key metrics', async ({ page }) => {
    test.skip(!repoId, 'No repos in DB yet')
    await page.goto(`/repos/${repoId}`)
    await page.getByRole('tab', { name: 'Overview' }).click()
    await expect(page.getByText('Last Push')).toBeVisible()
    await expect(page.getByText('Monthly Commits')).toBeVisible()
  })

  test('tech stack tab loads', async ({ page }) => {
    test.skip(!repoId, 'No repos in DB yet')
    await page.goto(`/repos/${repoId}`)
    await page.getByRole('tab', { name: 'Tech Stack' }).click()
    // Should show stack cards or "no data" message
    const hasStack = await page.locator('text=Frontend').isVisible().catch(() => false)
    const hasEmpty = await page.locator('text=No tech stack data').isVisible().catch(() => false)
    expect(hasStack || hasEmpty).toBe(true)
  })

  test('returns 404 for non-existent repo', async ({ page }) => {
    await page.goto('/repos/999999999')
    await expect(page).toHaveURL(/repos\/999999999/)
    // Next.js notFound() should render the not-found page
    await expect(page.locator('body')).toContainText(/not found|404/i)
  })
})
