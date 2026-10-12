/**
 * The public profile and résumé are for visitors (employers, customers): they show projects, stacks
 * and what's live, never health scores (red 42–54 badges read as "this person's work is unhealthy").
 */
import { test, expect } from '@playwright/test'
import { neon } from '@neondatabase/serverless'

const DB_URL = process.env.DATABASE_URL ?? ''

async function publicLogin(): Promise<string | null> {
  if (!DB_URL) return null
  const [u] = await neon(DB_URL)`SELECT github_login FROM users WHERE public_profile = true AND github_login IS NOT NULL ORDER BY last_synced_at DESC NULLS LAST LIMIT 1`
  return (u?.github_login as string | undefined) ?? null
}

test.describe('Public profile and résumé', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  for (const path of ['', '/resume']) {
    test(`show no health scores (/u/<login>${path})`, async ({ page }) => {
      const login = await publicLogin()
      test.skip(!login, 'no user with a public profile')
      await page.goto(`/u/${login}${path}`)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      await expect(page.getByText(/Avg health/i)).toHaveCount(0)
      await expect(page.getByText(/\d+ healthy/)).toHaveCount(0)
      await expect(page.locator('[title^="Health "]')).toHaveCount(0)
    })
  }
})
