import { test, expect } from '@playwright/test'

test.describe('Settings page', () => {
  test('loads settings page', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    await expect(page.getByText('Account and sync configuration')).toBeVisible()
  })

  test('shows user profile card', async ({ page }) => {
    await page.goto('/settings')
    // Avatar section is always present for logged-in users
    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible()
    await expect(page.locator('img[alt]').first()).toBeVisible()
  })

  test('shows GitHub OAuth scopes', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByText('GitHub OAuth Scopes')).toBeVisible()
    // Scope badges are inside Badge components — use exact match within code/badge context
    await expect(page.getByText('security_events', { exact: true })).toBeVisible()
    await expect(page.getByText('read:user', { exact: true })).toBeVisible()
  })

  test('shows sync history section', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByText('Sync History')).toBeVisible()
  })

  test('shows scheduled jobs section', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByText('Scheduled Jobs')).toBeVisible()
    await expect(page.getByText('GitHub Sync')).toBeVisible()
    await expect(page.getByText('Security Scan')).toBeVisible()
    await expect(page.getByText('AI Summaries')).toBeVisible()
  })

  test('has sign out button', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible()
  })
})
