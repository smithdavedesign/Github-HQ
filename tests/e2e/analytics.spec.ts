import { test, expect } from '@playwright/test'
import { neon } from '@neondatabase/serverless'

const DB_URL = process.env.DATABASE_URL ?? ''

async function getContext() {
  const sql = neon(DB_URL)
  const [user] = await sql`SELECT id FROM users LIMIT 1`
  if (!user) return null
  return { userId: user.id as string }
}

async function snapshotRows(userId: string) {
  const sql = neon(DB_URL)
  return await sql`
    SELECT h.id, h.repo_id AS "repoId", h.health_score AS "healthScore", h.activity_score AS "activityScore", h.security_score AS "securityScore", h.recorded_date AS "recordedDate", h.recorded_at AS "recordedAt"
    FROM health_score_history h
    INNER JOIN repositories r ON r.id = h.repo_id
    WHERE r.user_id = ${userId}
    ORDER BY h.recorded_at DESC
  ` as Array<{ id: number; repoId: number; healthScore: number; activityScore: number | null; securityScore: number | null; recordedDate: string; recordedAt: string | null }>
}

async function restoreRows(rows: Array<{ repoId: number; healthScore: number; activityScore: number | null; securityScore: number | null; recordedDate: string; recordedAt: string | null }>) {
  if (!DB_URL || rows.length === 0) return
  const sql = neon(DB_URL)
  for (const row of rows) {
    await sql`
      INSERT INTO health_score_history (repo_id, health_score, activity_score, security_score, recorded_date, recorded_at)
      VALUES (${row.repoId}, ${row.healthScore}, ${row.activityScore}, ${row.securityScore}, ${row.recordedDate}, ${row.recordedAt ?? new Date().toISOString()})
      ON CONFLICT (repo_id, recorded_date) DO NOTHING
    `
  }
}

async function seedTempRepo(userId: string) {
  const sql = neon(DB_URL)
  const githubId = Number(String(Date.now()).slice(-9))
  const createdAt = new Date().toISOString()
  const [repo] = await sql`
    INSERT INTO repositories (
      user_id, github_id, name, owner, full_name, visibility,
      created_at, updated_at, lifecycle_status, estimated_effort, is_focused
    )
    VALUES (
      ${userId}, ${githubId}, ${'analytics-fallback-' + githubId}, ${'test'}, ${'test/analytics-fallback-' + githubId},
      'private', ${createdAt}, ${createdAt}, 'maintaining', 'medium', false
    )
    RETURNING id
  `

  await sql`
    INSERT INTO repository_metrics (repo_id, health_score, activity_score, security_score, calculated_at)
    VALUES (${repo.id}, 73, 42, 88, NOW())
  `

  return { repoId: repo.id as number }
}

test.describe('Analytics page', () => {
  test('loads the analytics page', async ({ page }) => {
    await page.goto('/analytics')
    await expect(page.getByRole('heading', { name: 'Analytics' })).toBeVisible()
    await expect(page.getByText('Portfolio health trends')).toBeVisible()
  })

  test('shows chart or empty state', async ({ page }) => {
    await page.goto('/analytics')
    // Recharts measures its container asynchronously — wait for network idle
    await page.waitForLoadState('networkidle')
    const hasChart = await page.locator('.recharts-wrapper').isVisible({ timeout: 3000 }).catch(() => false)
    const hasEmpty = await page.getByText('No data yet').isVisible({ timeout: 1000 }).catch(() => false)
    expect(hasChart || hasEmpty).toBe(true)
  })

  test('shows a live snapshot when trend history is not warmed up', async ({ page }) => {
    test.setTimeout(60000)
    test.skip(!DB_URL, 'DATABASE_URL not set')

    const ctx = await getContext()
    if (!ctx?.userId) { test.skip(true, 'No user'); return }

    const sql = neon(DB_URL)
    const backup = await snapshotRows(ctx.userId)
    const tempRepo = await seedTempRepo(ctx.userId)

    try {
      await sql`
        DELETE FROM health_score_history
        WHERE repo_id IN (
          SELECT id FROM repositories WHERE user_id = ${ctx.userId}
        )
      `

      await page.goto('/analytics')
      await expect(page.getByText('Showing live snapshot')).toBeVisible({ timeout: 8000 })
      await expect(page.getByText('History snapshots are still warming up')).toBeVisible({ timeout: 8000 })
    } finally {
      await sql`DELETE FROM repository_metrics WHERE repo_id = ${tempRepo.repoId}`
      await sql`DELETE FROM repositories WHERE id = ${tempRepo.repoId}`
      await restoreRows(backup)
    }
  })
})
