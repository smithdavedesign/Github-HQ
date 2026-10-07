/**
 * Run agent, end to end in the browser (roadmap Phase 81): launch a skill on a repo's Agent tab →
 * the request is queued in Neon and Redis → the real worker runs the job → the launcher shows the
 * outcome → the Agents page lists the request with its findings, PR and step trace. Then the
 * owner's controls on a request: cancel while queued, retry.
 */
import { expect, test, type Page } from '@playwright/test'
import { FLOW_FINDING_LINES, FLOW_PR_URL, objective } from '../harness/scenarios'
import { seeded } from './env'

async function openAgentTab(page: Page, repoId: number) {
  await page.goto(`/repos/${repoId}`)
  await page.getByRole('tab', { name: /Agent/i }).click()
}

async function launch(page: Page, skill: string, text: string, phase?: string) {
  if (phase) await page.getByRole('button', { name: `Expand ${phase} skills` }).click()
  await page.getByRole('button', { name: `Expand ${skill}` }).click()
  await page.locator('textarea').fill(text)
  await page.getByRole('button', { name: `Run ${skill}` }).click()
  await expect(page.getByText(`${skill} queued for the factory`)).toBeVisible()
}

function requestRow(page: Page, text: string) {
  return page.getByTestId('request-row').filter({ hasText: text })
}

test.describe('Run agent', () => {
  test('a report skill: queued → Report ready with the findings, then traced on the Agents page', async ({ page }) => {
    const { reportRepo } = seeded()
    const text = objective('Score the code health of the API', 'report')
    await openAgentTab(page, reportRepo.id)
    await launch(page, '/health', text)

    // The launcher polls the status API (every 15 s).
    await expect(page.getByText('Report ready ↓')).toBeVisible({ timeout: 45_000 })
    await expect(page.getByText(FLOW_FINDING_LINES[0])).toBeVisible()

    await page.goto('/agent-performance')
    const row = requestRow(page, text)
    await expect(row.getByText('reported', { exact: true })).toBeVisible()
    await expect(row).toContainText('/health')
    await expect(row).toContainText('ui-skill')
    await row.getByRole('button', { name: 'Show trace' }).click()
    await expect(row.locator('pre')).toContainText('## Findings')
    const trace = row.getByTestId('trace-view')
    for (const step of ['Request', 'Clone', 'Install (sandbox)', 'Baseline checks', 'Report']) await expect(trace).toContainText(step)
    await expect(trace).toContainText('typecheck · lint · test')
  })

  test('a fix skill: queued → PR Ready, with the PR and the attempt on the Agents page', async ({ page }) => {
    const { prRepo } = seeded()
    const text = objective('Fix the flaky date test', 'pr')
    await openAgentTab(page, prRepo.id)
    await launch(page, '/ship', text, 'Ship')

    await expect(page.getByText('PR Ready ✓')).toBeVisible({ timeout: 45_000 })

    await page.goto('/agent-performance')
    const row = requestRow(page, text)
    await expect(row.getByText('pr', { exact: true })).toBeVisible()
    await expect(row.getByRole('link', { name: 'PR' })).toHaveAttribute('href', FLOW_PR_URL)
    await row.getByRole('button', { name: 'Show trace' }).click()
    const trace = row.getByTestId('trace-view')
    await expect(trace).toContainText('free-agent')
    for (const step of ['Attempt', 'Judge', 'Draft PR']) await expect(trace).toContainText(step)
  })

  test('the owner cancels a queued request and retries it; resumed, the retry runs', async ({ page }) => {
    const { controlsRepo } = seeded()
    const text = objective('Review the session handling', 'report')

    await page.goto('/agent-performance')
    await page.getByRole('button', { name: 'Pause queue' }).click()
    await expect(page.getByRole('button', { name: 'Resume queue' })).toBeVisible()
    try {
      await openAgentTab(page, controlsRepo.id)
      await launch(page, '/review', text)

      await page.goto('/agent-performance')
      const row = requestRow(page, text)
      await expect(row.getByText('queued', { exact: true })).toBeVisible()
      await row.getByRole('button', { name: 'Cancel' }).click()
      await expect(page.getByText('Request cancelled')).toBeVisible()
      await expect(row.getByText('cancelled', { exact: true })).toBeVisible()
      await expect(row).toContainText('Cancelled from the Agents page')

      await row.getByRole('button', { name: 'Retry' }).click()
      await expect(page.getByText('Queued again')).toBeVisible()
      await expect(requestRow(page, text)).toHaveCount(2)
      await expect(requestRow(page, text).filter({ hasText: 'queued' })).toHaveCount(1)
    } finally {
      const resume = page.getByRole('button', { name: 'Resume queue' })
      if (await resume.isVisible()) await resume.click()
    }
    await expect(page.getByRole('button', { name: 'Pause queue' })).toBeVisible()
    // Resumed: the retried request runs and reports (the panel refreshes every 15 s).
    await expect(requestRow(page, text).getByText('reported', { exact: true })).toBeVisible({ timeout: 45_000 })
  })
})
