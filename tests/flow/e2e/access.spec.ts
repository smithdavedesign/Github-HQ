/**
 * Who sees and starts agent work (roadmap Phase 81): the factory works only for its owner and only
 * on allowlisted repos, and the Agents page's queue, schedules and traces are the owner's.
 */
import { expect, test } from '@playwright/test'
import { OTHER_STATE, seeded } from './env'

test.describe('the owner', () => {
  test('a repo off the allowlist explains why there are no agent skills', async ({ page }) => {
    const { outsideRepo } = seeded()
    await page.goto(`/repos/${outsideRepo.id}`)
    await page.getByRole('tab', { name: /Agent/i }).click()
    await expect(page.getByText(`Agent skills are not available for ${outsideRepo.name}`)).toBeVisible()
    await expect(page.getByText('is not on the factory allowlist')).toBeVisible()
    await expect(page.getByRole('button', { name: /^Run \// })).toHaveCount(0)
  })
})

test.describe('another signed-in user', () => {
  test.use({ storageState: OTHER_STATE })

  test('sees no queue, schedules or traces, and cannot launch agents', async ({ page }) => {
    await page.goto('/agent-performance')
    await expect(page.getByRole('heading', { name: 'Agents', exact: true })).toBeVisible()
    await expect(page.getByTestId('agent-hq-unavailable')).toContainText('The factory runs agents for its owner only.')
    await expect(page.getByTestId('agent-hq')).toHaveCount(0)

    const { otherRepo } = seeded()
    await page.goto(`/repos/${otherRepo.id}`)
    await page.getByRole('tab', { name: /Agent/i }).click()
    await expect(page.getByText('The factory runs agents for its owner only.')).toBeVisible()
  })

  test('the Agent HQ API refuses them', async ({ page }) => {
    await page.goto('/agent-performance')
    expect((await page.request.get('/api/agent-hq')).status()).toBe(403)
    expect((await page.request.get('/api/agent-hq/trace?runId=x')).status()).toBe(403)
  })
})

test.describe('signed out', () => {
  test.use({ storageState: { cookies: [], origins: [] } })

  test('the Agents page sends you to log in; the APIs answer 401', async ({ page }) => {
    await page.goto('/agent-performance')
    await expect(page).toHaveURL(/\/login/)
    expect((await page.request.get('/api/agent-hq')).status()).toBe(401)
    expect((await page.request.get('/api/agent-task-status?taskId=x')).status()).toBe(401)
  })
})
