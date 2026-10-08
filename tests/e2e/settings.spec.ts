import { test, expect } from '@playwright/test'

test.describe('Settings page', () => {
  test('loads settings page', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    for (const section of ['AI provider', 'Notifications', 'Agents', 'Revenue', 'Public profile']) {
      await expect(page.locator('main').getByText(section, { exact: true })).toBeVisible()
    }
  })

  test('shows user profile card', async ({ page }) => {
    await page.goto('/settings')
    // Avatar section is always present for logged-in users
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    await expect(page.locator('img[alt]').first()).toBeVisible()
  })

  test('account is one line: GitHub sign-in, no scope badges card', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByText(/Signed in with GitHub/)).toBeVisible()
    await expect(page.getByText('GitHub OAuth Scopes')).toHaveCount(0)
  })

  test('switches show their state (Radix data-state is bridged to the data-checked variant)', async ({ page }) => {
    await page.goto('/settings')
    const sw = page.locator('[data-slot=switch]').first()
    await expect(sw).toBeVisible()
    const bg = await sw.evaluate(e => getComputedStyle(e).backgroundColor)
    expect(bg).not.toBe('rgba(0, 0, 0, 0)')
  })

  test('sync history and scheduled jobs live on the Agents page now', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByText('Sync History')).toHaveCount(0)
    await page.goto('/agent-performance')
    await expect(page.getByText('Data sync', { exact: true })).toBeVisible({ timeout: 8000 })
    await expect(page.getByText('GitHub sync', { exact: true })).toBeVisible()
    await expect(page.getByText('Security scan', { exact: true })).toBeVisible()
  })

  test('has sign out button', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
  })
})
