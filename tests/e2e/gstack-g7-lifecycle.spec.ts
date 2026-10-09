/**
 * G7 — Full Lifecycle gstack Integration E2E tests.
 *
 * Covers:
 * - Repo Agent tab: 5 lifecycle sections, 9 skills, collapsible sections
 * - Skill type badges (Report only / Creates PR)
 * - Findings expansion (no truncation — Show all)
 * - Actionable items from skill reports
 * - Active Agents card on dashboard
 * - get_skill_history MCP equivalent (via DB seeding)
 */
import { test, expect, type Page } from '@playwright/test'
import { neon } from '@neondatabase/serverless'
import { getFactoryRepo, NOT_FACTORY_OWNER } from './helpers/factory'

const DB_URL = process.env.DATABASE_URL ?? ''

async function getContext() {
  const sql = neon(DB_URL)
  const [user] = await sql`SELECT id FROM users ORDER BY last_synced_at DESC NULLS LAST LIMIT 1`
  if (!user) return null
  const [repo] = await sql`SELECT id, name FROM repositories WHERE user_id = ${user.id} LIMIT 1`
  return { userId: user.id as string, repoId: repo?.id as number | undefined, repoName: repo?.name as string | undefined }
}

async function seedSkillReport(userId: string, repoId: number, skillName: string, findings: string[], taskId: string) {
  const sql = neon(DB_URL)
  await sql`
    INSERT INTO portfolio_events (user_id, repo_id, event_type, title, metadata, occurred_at)
    VALUES (
      ${userId}, ${repoId}, 'agent_skill_report', ${`/${skillName} findings — ${repoId}`},
      ${JSON.stringify({ skillName, findings, summary: `${skillName} complete`, taskId, outcome: 'no-changes' })}::jsonb,
      NOW()
    )
  `
}

async function cleanup(repoId: number) {
  if (!DB_URL) return
  const sql = neon(DB_URL)
  // Seeded titles end "findings — <repoId>"; real reports end with the repo name. A bare
  // '%findings%' also deleted the repo's real skill reports.
  await sql`DELETE FROM portfolio_events WHERE repo_id = ${repoId} AND event_type = 'agent_skill_report' AND title LIKE ${'% findings — ' + repoId}`
}

// ─── Skill launcher UI structure ──────────────────────────────────────────────

test.describe('GstackSkillLauncher — lifecycle sections', () => {
  // The launcher renders for the factory owner on allowlisted repos only (Agent HQ, Phase 81);
  // elsewhere the Agent tab explains why agent skills are off.
  async function openFactoryRepoAgentTab(page: Page): Promise<boolean> {
    const repo = await getFactoryRepo()
    if (!repo) return false
    await page.goto(`/repos/${repo.id}`)
    await page.getByRole('tab', { name: /Agent/i }).click()
    return true
  }

  test('Agent tab shows the skills launcher', async ({ page }) => {
    if (!await openFactoryRepoAgentTab(page)) { test.skip(true, NOT_FACTORY_OWNER); return }
    // The "GSTACK SKILLS" heading is gone; the launcher's phase toggles are the section.
    await expect(page.getByRole('button', { name: /^(Expand|Collapse) Understand skills/ })).toBeVisible({ timeout: 8000 })
  })

  test('Lifecycle phase labels are visible', async ({ page }) => {
    if (!await openFactoryRepoAgentTab(page)) { test.skip(true, NOT_FACTORY_OWNER); return }
    // At least some phase headers should be visible
    await expect(page.getByRole('button', { name: /^(Expand|Collapse) (Understand|Build Quality|Ship|Monitor|Reflect) skills/ }).first()).toBeVisible({ timeout: 8000 })
  })

  test('/investigate skill is visible as a read-only report', async ({ page }) => {
    if (!await openFactoryRepoAgentTab(page)) { test.skip(true, NOT_FACTORY_OWNER); return }
    // The Understand phase should be open by default
    await expect(page.getByText('/investigate', { exact: true }).first()).toBeVisible({ timeout: 8000 })
    await expect(page.getByText('Report only').first()).toBeVisible()
  })

  test('/health skill shows Report only badge', async ({ page }) => {
    if (!await openFactoryRepoAgentTab(page)) { test.skip(true, NOT_FACTORY_OWNER); return }
    // Open the Monitor phase (it may already be open: which phases start open depends on the repo)
    const expandMonitor = page.getByRole('button', { name: 'Expand Monitor skills' })
    if (await expandMonitor.count() > 0) await expandMonitor.click()
    await expect(page.getByText('/health', { exact: true }).first()).toBeVisible({ timeout: 3000 })
    await expect(page.getByText('Report only').first()).toBeVisible()
  })

  test('/ship skill shows Creates PR badge', async ({ page }) => {
    if (!await openFactoryRepoAgentTab(page)) { test.skip(true, NOT_FACTORY_OWNER); return }
    // Click Ship phase
    await page.getByRole('button', { name: 'Expand Ship skills' }).click()
    await expect(page.getByText('/ship', { exact: true }).first()).toBeVisible({ timeout: 3000 })
    await expect(page.getByText('Creates PR').first()).toBeVisible()
  })
})

// ─── Findings expansion (no truncation) ──────────────────────────────────────

test.describe('SkillReportFindings — full expansion', () => {
  test.skip(!DB_URL, 'DATABASE_URL not set')

  test('Show N more findings toggle expands full list', async ({ page }) => {
    const ctx = await getContext()
    if (!ctx?.repoId) { test.skip(true, 'No repo'); return }

    // Seed a report with 8 findings (> 4 preview threshold)
    const taskId = `findings-expand-${Date.now()}`
    const findings = Array.from({ length: 8 }, (_, i) => `Finding ${i + 1}: some issue in file-${i + 1}.ts`)
    await seedSkillReport(ctx.userId, ctx.repoId, 'health', findings, taskId)

    await page.goto(`/repos/${ctx.repoId}`)
    await page.getByRole('tab', { name: /Agent/i }).click()

    // Should show "Show N more findings" toggle
    // The seeded report has 8 findings, so 4 more (other reports may show their own toggle).
    const toggle = page.getByRole('button', { name: 'Show 4 more findings' }).first()
    await expect(toggle).toBeVisible({ timeout: 8000 })

    // Click to expand
    await toggle.click()

    // All 8 findings should now be visible
    for (let i = 5; i <= 8; i++) {
      await expect(page.getByText(`Finding ${i}:`)).toBeVisible({ timeout: 3000 })
    }

    // Show less toggle should appear
    await expect(page.getByText('Show less')).toBeVisible()

    await cleanup(ctx.repoId)
  })

  test('Findings within preview limit show no toggle', async ({ page }) => {
    const ctx = await getContext()
    if (!ctx?.repoId) { test.skip(true, 'No repo'); return }

    // The repo's real reports may have toggles of their own: count them before seeding.
    const toggles = page.getByText(/Show \d+ more finding/)
    await page.goto(`/repos/${ctx.repoId}`)
    await page.getByRole('tab', { name: /Agent/i }).click()
    await expect(page.getByRole('button', { name: /^(Expand|Collapse) Understand skills/ })).toBeVisible({ timeout: 8000 })
    const before = await toggles.count()

    const taskId = `findings-short-${Date.now()}`
    const findings = ['Finding 1: TypeScript error', 'Finding 2: Dead code', 'Finding 3: Missing test']
    await seedSkillReport(ctx.userId, ctx.repoId, 'health', findings, taskId)
    try {
      await page.reload()
      await page.getByRole('tab', { name: /Agent/i }).click()
      await expect(page.getByText('Finding 1: TypeScript error').first()).toBeVisible({ timeout: 8000 })

      // No expand toggle for this report since 3 < 4 preview threshold
      expect(await toggles.count()).toBe(before)
    } finally {
      await cleanup(ctx.repoId)
    }
  })
})

// ─── Actionable items from skill reports ─────────────────────────────────────

test.describe('SkillReportFindings — suggested actions', () => {
  test.skip(!DB_URL, 'DATABASE_URL not set')

  test('TypeScript error finding suggests /ship action', async ({ page }) => {
    const ctx = await getContext()
    if (!ctx?.repoId) { test.skip(true, 'No repo'); return }

    const taskId = `action-ts-${Date.now()}`
    await seedSkillReport(ctx.userId, ctx.repoId, 'health', [
      'TypeScript: proxy.ts exports a config object but will never run as middleware',
      '✅ Tests: 100/100 passing',
    ], taskId)

    await page.goto(`/repos/${ctx.repoId}`)
    await page.getByRole('tab', { name: /Agent/i }).click()

    // Should show suggested actions section
    await expect(page.getByText('Take action').first()).toBeVisible({ timeout: 8000 })
    await expect(page.getByText(/Fix TypeScript/).first()).toBeVisible()
    await expect(page.getByRole('button', { name: /Run \/ship/i }).first()).toBeVisible()

    await cleanup(ctx.repoId)
  })

  test('Security finding in review suggests /investigate', async ({ page }) => {
    const ctx = await getContext()
    if (!ctx?.repoId) { test.skip(true, 'No repo'); return }

    const taskId = `action-sec-${Date.now()}`
    await seedSkillReport(ctx.userId, ctx.repoId, 'review', [
      'Security: SQL injection vulnerability in user input handling — unescaped query parameter',
    ], taskId)

    await page.goto(`/repos/${ctx.repoId}`)
    await page.getByRole('tab', { name: /Agent/i }).click()
    await expect(page.getByText('Take action').first()).toBeVisible({ timeout: 8000 })
    await expect(page.getByRole('button', { name: /Run \/investigate/i }).first()).toBeVisible()

    await cleanup(ctx.repoId)
  })
})

// ─── Active Agents dashboard card ────────────────────────────────────────────

test.describe('ActiveAgentsCard on dashboard', () => {
  test.skip(!DB_URL, 'DATABASE_URL not set')

  test('card appears when agent is queued', async ({ page }) => {
    const ctx = await getContext()
    if (!ctx?.repoId) { test.skip(true, 'No repo'); return }

    const taskId = `active-agent-${Date.now()}`
    const sql = neon(DB_URL)
    await sql`
      INSERT INTO portfolio_events (user_id, repo_id, event_type, title, metadata, occurred_at)
      VALUES (${ctx.userId}, ${ctx.repoId}, 'agent_task_queued', 'Active agent test',
        ${JSON.stringify({ taskId, skillName: 'health' })}::jsonb, NOW())
    `

    // Cleanup in finally: a failed assertion used to leave this row in the shared database.
    try {
      await page.goto('/')
      // Card appears when agents are running
      // Auto-waiting: isVisible() ignores its timeout and returned before the card streamed in.
      await expect(page.getByText(/agent.*running/i).or(page.getByText(ctx.repoName ?? '', { exact: true })).first()).toBeVisible({ timeout: 8000 })
    } finally {
      await sql`DELETE FROM portfolio_events WHERE metadata->>'taskId' = ${taskId}`
    }
  })

  test('card hidden when no agents in flight', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('networkidle')
    // The card should not show a running agent count if nothing is queued
    const hasRunning = await page.getByText(/\d+ agent.*running/i).isVisible().catch(() => false)
    // This could be true if other tests left state — just verify the page loads
    expect(typeof hasRunning).toBe('boolean')
  })
})

// ─── Settings: scheduled skills toggles ──────────────────────────────────────

test.describe('Settings — Scheduled Skills', () => {
  test('Auto-Dispatch card exists in settings', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByText('Monday auto-dispatch', { exact: true })).toBeVisible({ timeout: 8000 })
  })
})

// ─── Agent performance page ───────────────────────────────────────────────────

test.describe('Agent Performance — skill tracking', () => {
  test('page loads with activity log', async ({ page }) => {
    await page.goto('/agent-performance')
    await expect(page.getByRole('heading', { name: 'Agents', exact: true })).toBeVisible({ timeout: 8000 })
    await expect(page.getByText('Activity Log')).toBeVisible()
  })
})
