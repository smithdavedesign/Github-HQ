import { test, expect } from '@playwright/test'
import { neon } from '@neondatabase/serverless'

const DB_URL = process.env.DATABASE_URL ?? ''

async function getContext() {
  const sql = neon(DB_URL)
  const [user] = await sql`SELECT id FROM users ORDER BY last_synced_at DESC NULLS LAST LIMIT 1`
  if (!user) return null
  const [repo] = await sql`SELECT id, name FROM repositories WHERE user_id = ${user.id} LIMIT 1`
  return { userId: user.id as string, repoId: repo?.id as number | undefined, repoName: repo?.name as string | undefined }
}

async function seedEvent(userId: string, repoId: number, eventType: string, title: string, metadata: Record<string, unknown>, description?: string) {
  const sql = neon(DB_URL)
  await sql`
    INSERT INTO portfolio_events (user_id, repo_id, event_type, title, description, metadata, occurred_at)
    VALUES (
      ${userId}, ${repoId}, ${eventType}, ${title}, ${description ?? null},
      ${JSON.stringify(metadata)}::jsonb,
      NOW()
    )
  `
}

async function cleanup(prefix: string) {
  if (!DB_URL) return
  const sql = neon(DB_URL)
  await sql`DELETE FROM portfolio_events WHERE title LIKE ${prefix + '%'} OR description LIKE ${prefix + '%'}`
}

test.describe('Feed page', () => {
  test('loads the feed page', async ({ page }) => {
    await page.goto('/feed')
    await expect(page.getByRole('heading', { name: 'Portfolio Feed', exact: true })).toBeVisible()
  })

  test('shows Feed and Milestones tabs', async ({ page }) => {
    await page.goto('/feed')
    // Scope to the tab switcher in main, not the sidebar nav link
    const main = page.locator('main, [role="main"], .space-y-4').first()
    await expect(main.getByRole('link', { name: 'Feed', exact: true })).toBeVisible()
    await expect(main.getByRole('link', { name: 'Milestones', exact: true })).toBeVisible()
  })

  test('shows successful report-only and failed agent entries', async ({ page }) => {
    test.skip(!DB_URL, 'DATABASE_URL not set')

    const ctx = await getContext()
    if (!ctx?.repoId) { test.skip(true, 'No repo'); return }

    const prefix = `feed-agent-${Date.now()}`

    await seedEvent(ctx.userId, ctx.repoId, 'agent_skill_report', `${prefix}-success`, {
      taskId: `${prefix}-success-task`,
      skillName: 'health',
      findings: ['Live scan completed with no blockers'],
      outcome: 'no-changes',
    }, `/${'health'} report ready`)

    await seedEvent(ctx.userId, ctx.repoId, 'agent_execution_failed', `${prefix}-failure`, {
      taskId: `${prefix}-failure-task`,
      agentName: 'RepoHQ worker',
      summary: 'Execution failed: Repository clone failed: the GitHub repo could not be accessed.',
    }, 'Execution failed: Repository clone failed: the GitHub repo could not be accessed.')

    // Cleanup in finally: a failed assertion used to leave these rows in the shared database.
    try {
      await page.goto('/feed')
      await expect(page.getByText('/health report ready').first()).toBeVisible({ timeout: 8000 })
      await expect(page.getByText('Agent execution failed', { exact: true }).first()).toBeVisible({ timeout: 8000 })
      await expect(page.getByText(/Repository clone failed: the GitHub repo could not be accessed/i).first()).toBeVisible({ timeout: 8000 })
    } finally {
      await cleanup(prefix)
    }
  })

  test('Milestones tab loads', async ({ page }) => {
    await page.goto('/feed?tab=milestones')
    await expect(page.getByRole('button', { name: /Add milestone/i })).toBeVisible()
  })

  test('unauthenticated users are redirected to login', async ({ browser }) => {
    const context = await browser.newContext({ storageState: undefined })
    const page = await context.newPage()
    await page.goto('/feed')
    await expect(page).toHaveURL(/\/login/)
    await context.close()
  })
})
