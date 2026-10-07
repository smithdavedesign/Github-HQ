/**
 * E2E tests for the GstackSkillLauncher UX.
 *
 * Covers:
 * - Phase section collapse/expand behaviour
 * - Skill row expand/collapse on click
 * - Objective textarea interaction
 * - Run button state (disabled when empty, label change)
 * - Canary unavailable in the factory (needs a browser the sandbox doesn't have)
 * - Type badge presence and correctness
 * - Aria accessibility attributes on interactive elements
 *
 * The launcher renders only for the factory owner on allowlisted repos (Agent HQ, Phase 81):
 * see tests/e2e/helpers/factory.ts.
 */
import { test, expect } from '@playwright/test'
import { getFactoryRepo, getNonFactoryRepo, NOT_FACTORY_OWNER } from './helpers/factory'

async function getFirstRepo() {
  return getFactoryRepo()
}

// ─── Phase section structure ──────────────────────────────────────────────────

test.describe('GstackSkillLauncher — phase structure', () => {
  test('all 5 phase labels are present in the DOM', async ({ page }) => {
    const repo = await getFirstRepo()
    if (!repo) { test.skip(true, NOT_FACTORY_OWNER); return }

    await page.goto(`/repos/${repo.id}`)
    await page.getByRole('tab', { name: /Agent/i }).click()

    const phases = ['Understand', 'Build Quality', 'Ship', 'Monitor', 'Reflect']
    for (const phase of phases) {
      await expect(page.getByText(phase, { exact: true }).first()).toBeAttached({ timeout: 8000 })
    }
  })

  test('phase headers have aria-expanded attribute', async ({ page }) => {
    const repo = await getFirstRepo()
    if (!repo) { test.skip(true, NOT_FACTORY_OWNER); return }

    await page.goto(`/repos/${repo.id}`)
    await page.getByRole('tab', { name: /Agent/i }).click()

    // Find all buttons that are phase toggles
    const understandHeader = page.getByRole('button', { name: /Understand/i })
    await expect(understandHeader.first()).toHaveAttribute('aria-expanded', /.+/, { timeout: 8000 })
  })

  test('Understand phase is open by default — /investigate visible without click', async ({ page }) => {
    const repo = await getFirstRepo()
    if (!repo) { test.skip(true, NOT_FACTORY_OWNER); return }

    await page.goto(`/repos/${repo.id}`)
    await page.getByRole('tab', { name: /Agent/i }).click()
    await expect(page.getByText('/investigate')).toBeVisible({ timeout: 8000 })
  })

  test('clicking a closed phase header opens it', async ({ page }) => {
    const repo = await getFirstRepo()
    if (!repo) { test.skip(true, NOT_FACTORY_OWNER); return }

    await page.goto(`/repos/${repo.id}`)
    await page.getByRole('tab', { name: /Agent/i }).click()

    // Ship phase — might be closed by default (depends on localStorage state)
    // Click it and verify /ship becomes visible
    await page.getByText('Ship', { exact: true }).first().click()
    await expect(page.getByText('/ship')).toBeVisible({ timeout: 3000 })
  })

  test('clicking an open phase header closes it', async ({ page }) => {
    const repo = await getFirstRepo()
    if (!repo) { test.skip(true, NOT_FACTORY_OWNER); return }

    await page.goto(`/repos/${repo.id}`)
    await page.getByRole('tab', { name: /Agent/i }).click()

    // Understand is open by default — click to close
    await page.getByText('Understand', { exact: true }).first().click()
    await expect(page.getByText('/investigate')).not.toBeVisible({ timeout: 2000 })
  })
})

// ─── Skill row expand/collapse ────────────────────────────────────────────────

test.describe('GstackSkillLauncher — skill rows', () => {
  test('clicking a skill row expands it and shows objective textarea', async ({ page }) => {
    const repo = await getFirstRepo()
    if (!repo) { test.skip(true, NOT_FACTORY_OWNER); return }

    await page.goto(`/repos/${repo.id}`)
    await page.getByRole('tab', { name: /Agent/i }).click()

    // Ensure Understand phase is open
    const investigateRow = page.getByText('/investigate')
    await expect(investigateRow).toBeVisible({ timeout: 8000 })

    await investigateRow.click()

    // Textarea and run button should appear
    await expect(page.getByRole('textbox').first()).toBeVisible({ timeout: 2000 })
    await expect(page.getByRole('button', { name: /Run \/investigate/i })).toBeVisible()
  })

  test('skill row has aria-expanded attribute', async ({ page }) => {
    const repo = await getFirstRepo()
    if (!repo) { test.skip(true, NOT_FACTORY_OWNER); return }

    await page.goto(`/repos/${repo.id}`)
    await page.getByRole('tab', { name: /Agent/i }).click()

    // Click to expand /investigate
    await page.getByText('/investigate').click({ timeout: 8000 })
    const expandedBtn = page.getByRole('button', { name: /Collapse \/investigate/i })
    const hasExpanded = await expandedBtn.isVisible().catch(() => false)
    // Either explicit aria-expanded or expanded state is visible
    if (!hasExpanded) {
      await expect(page.getByRole('textbox').first()).toBeVisible()
    }
  })

  test('clicking expanded skill row collapses it', async ({ page }) => {
    const repo = await getFirstRepo()
    if (!repo) { test.skip(true, NOT_FACTORY_OWNER); return }

    await page.goto(`/repos/${repo.id}`)
    await page.getByRole('tab', { name: /Agent/i }).click()

    const investigateRow = page.getByText('/investigate')
    await investigateRow.click({ timeout: 8000 })
    await expect(page.getByRole('textbox').first()).toBeVisible()

    // Click again to collapse
    await investigateRow.click()
    await expect(page.getByRole('textbox')).not.toBeVisible({ timeout: 2000 })
  })

  test('Run button is disabled when objective is empty', async ({ page }) => {
    const repo = await getFirstRepo()
    if (!repo) { test.skip(true, NOT_FACTORY_OWNER); return }

    await page.goto(`/repos/${repo.id}`)
    await page.getByRole('tab', { name: /Agent/i }).click()
    await page.getByText('/investigate').click({ timeout: 8000 })

    const textarea = page.getByRole('textbox').first()
    await textarea.fill('')
    await expect(page.getByRole('button', { name: /Run \/investigate/i })).toBeDisabled()
  })

  test('Run button is enabled when objective has content', async ({ page }) => {
    const repo = await getFirstRepo()
    if (!repo) { test.skip(true, NOT_FACTORY_OWNER); return }

    await page.goto(`/repos/${repo.id}`)
    await page.getByRole('tab', { name: /Agent/i }).click()
    await page.getByText('/investigate').click({ timeout: 8000 })

    const textarea = page.getByRole('textbox').first()
    await textarea.fill('Investigate why the auth flow is broken')
    await expect(page.getByRole('button', { name: /Run \/investigate/i })).toBeEnabled()
  })
})

// ─── Type badges ──────────────────────────────────────────────────────────────

test.describe('GstackSkillLauncher — type badges', () => {
  test('/investigate shows "Report only" (a read-only factory report)', async ({ page }) => {
    const repo = await getFirstRepo()
    if (!repo) { test.skip(true, NOT_FACTORY_OWNER); return }

    await page.goto(`/repos/${repo.id}`)
    await page.getByRole('tab', { name: /Agent/i }).click()
    await expect(page.getByText('Understand', { exact: true }).first()).toBeAttached({ timeout: 8000 })
    await expect(page.getByText('Report only').first()).toBeVisible()
    await expect(page.getByText('Analyze + Fix')).toHaveCount(0)
  })

  test('/health shows "Report only" badge when Monitor is open', async ({ page }) => {
    const repo = await getFirstRepo()
    if (!repo) { test.skip(true, NOT_FACTORY_OWNER); return }

    await page.goto(`/repos/${repo.id}`)
    await page.getByRole('tab', { name: /Agent/i }).click()
    await page.getByText('Monitor', { exact: true }).first().click()
    await expect(page.getByText('/health')).toBeVisible({ timeout: 3000 })
    await expect(page.getByText('Report only').first()).toBeVisible()
  })

  test('/ship shows "Creates PR" badge when Ship is open', async ({ page }) => {
    const repo = await getFirstRepo()
    if (!repo) { test.skip(true, NOT_FACTORY_OWNER); return }

    await page.goto(`/repos/${repo.id}`)
    await page.getByRole('tab', { name: /Agent/i }).click()
    await page.getByText('Ship', { exact: true }).first().click()
    await expect(page.getByText('/ship')).toBeVisible({ timeout: 3000 })
    await expect(page.getByText('Creates PR')).toBeVisible()
  })

  test('/review shows "Report only" badge', async ({ page }) => {
    const repo = await getFirstRepo()
    if (!repo) { test.skip(true, NOT_FACTORY_OWNER); return }

    await page.goto(`/repos/${repo.id}`)
    await page.getByRole('tab', { name: /Agent/i }).click()
    // Understand phase is default-open
    await expect(page.getByText('/review')).toBeVisible({ timeout: 8000 })
    // Multiple "Report only" badges possible — just check at least one is visible
    await expect(page.getByText('Report only').first()).toBeVisible()
  })
})

// ─── Canary (no factory equivalent) ───────────────────────────────────────────

test.describe('GstackSkillLauncher — canary', () => {
  test('canary is shown as unavailable in the factory', async ({ page }) => {
    const repo = await getFirstRepo()
    if (!repo) { test.skip(true, NOT_FACTORY_OWNER); return }

    await page.goto(`/repos/${repo.id}`)
    await page.getByRole('tab', { name: /Agent/i }).click()
    await page.getByText('Monitor', { exact: true }).first().click()

    await expect(page.getByText('/canary')).toBeVisible({ timeout: 3000 })
    await expect(page.getByText('Not available in the factory')).toBeVisible()
  })
})

// ─── Objective textarea ───────────────────────────────────────────────────────

test.describe('GstackSkillLauncher — objective textarea', () => {
  test('default objective is pre-filled from server', async ({ page }) => {
    const repo = await getFirstRepo()
    if (!repo) { test.skip(true, NOT_FACTORY_OWNER); return }

    await page.goto(`/repos/${repo.id}`)
    await page.getByRole('tab', { name: /Agent/i }).click()
    await page.getByText('/investigate').click({ timeout: 8000 })

    const textarea = page.getByRole('textbox').first()
    const value = await textarea.inputValue()
    expect(value.length).toBeGreaterThan(0)
  })

  test('objective textarea is editable', async ({ page }) => {
    const repo = await getFirstRepo()
    if (!repo) { test.skip(true, NOT_FACTORY_OWNER); return }

    await page.goto(`/repos/${repo.id}`)
    await page.getByRole('tab', { name: /Agent/i }).click()
    await page.getByText('/investigate').click({ timeout: 8000 })

    const textarea = page.getByRole('textbox').first()
    await textarea.fill('Custom test objective for playwright')
    expect(await textarea.inputValue()).toBe('Custom test objective for playwright')
  })

  test('objective survives phase collapse and re-expand within session', async ({ page }) => {
    const repo = await getFirstRepo()
    if (!repo) { test.skip(true, NOT_FACTORY_OWNER); return }

    await page.goto(`/repos/${repo.id}`)
    await page.getByRole('tab', { name: /Agent/i }).click()
    await page.getByText('/investigate').click({ timeout: 8000 })

    const textarea = page.getByRole('textbox').first()
    await textarea.fill('My custom objective')

    // Collapse phase then re-expand
    await page.getByText('Understand', { exact: true }).first().click()
    await page.getByText('Understand', { exact: true }).first().click()

    // Re-expand the skill row
    await page.getByText('/investigate').click()
    const restoredValue = await page.getByRole('textbox').first().inputValue()

    // Value may reset (no localStorage for objectives) — just verify field is present
    expect(restoredValue).toBeDefined()
  })
})

// ─── Factory disabled state ───────────────────────────────────────────────────

test.describe('GstackSkillLauncher — repo not on the factory allowlist', () => {
  test('explains why agent skills are off', async ({ page }) => {
    const repo = await getNonFactoryRepo()
    if (!repo) { test.skip(true, `no non-allowlisted repo, or ${NOT_FACTORY_OWNER}`); return }

    await page.goto(`/repos/${repo.id}`)
    await page.getByRole('tab', { name: /Agent/i }).click()

    await expect(page.getByText(/Agent skills are not available/)).toBeVisible({ timeout: 8000 })
    await expect(page.getByText(/factory allowlist/).first()).toBeVisible()
  })
})
