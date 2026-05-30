import { test, expect } from '@playwright/test'

// These tests run without a session (override storageState to empty)
test.describe('Authentication', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('login page renders correctly', async ({ page }) => {
    await page.goto('/login')
    await expect(page.getByRole('heading', { name: 'RepoHQ' })).toBeVisible()
    await expect(page.getByRole('button', { name: /Continue with GitHub/i })).toBeVisible()
    await expect(page.getByText('public + private')).toBeVisible()
  })

  test('protected routes redirect to login when unauthenticated', async ({ page }) => {
    for (const route of ['/repos', '/security', '/deployments', '/analytics', '/settings']) {
      await page.goto(route)
      await expect(page).toHaveURL(/\/login/, { timeout: 5000 })
    }
  })

  test('root redirects to login when unauthenticated', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL(/\/login/)
  })
})

// These tests verify authenticated users are NOT redirected
test.describe('Authenticated routing', () => {
  test('authenticated user can access dashboard', async ({ page }) => {
    await page.goto('/')
    await expect(page).toHaveURL('/')
    await expect(page.getByText('Portfolio Dashboard')).toBeVisible()
  })

  test('authenticated user is not redirected from protected routes', async ({ page }) => {
    for (const route of ['/repos', '/security', '/deployments', '/analytics', '/settings']) {
      await page.goto(route)
      await expect(page).not.toHaveURL(/\/login/)
    }
  })
})
