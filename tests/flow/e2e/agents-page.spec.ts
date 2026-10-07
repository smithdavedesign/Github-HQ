/**
 * The Agents page with a live worker (roadmap Phase 81, docs/agent-hq-migration-prd.md §9):
 * worker status from its Redis heartbeat, the schedules that replaced the launchd calendar, the
 * queue, Run now with its traced run, and pausing the queue.
 */
import { expect, test } from '@playwright/test'

test.describe('Agents page — automation', () => {
  test('shows the worker online, its schedules and the queue', async ({ page }) => {
    await page.goto('/agent-performance')
    await expect(page.getByRole('heading', { name: 'Agents', exact: true })).toBeVisible()
    await expect(page.getByTestId('worker-status')).toContainText('Worker online on')
    const schedules = page.getByTestId('schedulers')
    for (const [name, pattern] of [['cycle', '0 3 29 2 *'], ['report', '45 6 29 2 *'], ['scout', '10 17 29 2 *']]) {
      const row = schedules.locator('div').filter({ hasText: name }).filter({ hasText: pattern })
      await expect(row.first()).toBeVisible()
    }
    await expect(schedules).toContainText('America/Los_Angeles')
    await expect(page.getByTestId('queue-counts')).toContainText('Waiting')
  })

  test('Run cycle: the run shows up ok, and its trace opens', async ({ page }) => {
    await page.goto('/agent-performance')
    await page.getByRole('button', { name: 'Run cycle' }).click()
    await expect(page.getByText('cycle queued')).toBeVisible()
    // The panel refreshes every 15 s.
    const run = page.getByTestId('recent-runs').getByRole('button').filter({ hasText: 'Factory cycle' }).filter({ hasText: 'manual' })
    await expect(run.first()).toContainText('ok', { timeout: 45_000 })
    await run.first().click()
    const trace = page.getByTestId('trace-view')
    await expect(trace).toContainText('cycle')
    await expect(trace).toContainText('flow cycle')
  })

  test('pause and resume the queue', async ({ page }) => {
    await page.goto('/agent-performance')
    await page.getByRole('button', { name: 'Pause queue' }).click()
    await expect(page.getByRole('button', { name: 'Resume queue' })).toBeVisible()
    await expect(page.getByTestId('worker-status')).toContainText('queue paused')
    await page.getByRole('button', { name: 'Resume queue' }).click()
    await expect(page.getByRole('button', { name: 'Pause queue' })).toBeVisible()
    await expect(page.getByTestId('worker-status')).not.toContainText('queue paused')
  })
})
