/**
 * The Advisor's "Fix it". A repo the factory doesn't work on yet is opened to it from the repo page
 * (the factory's owner only), and a security item then queues the safe fix: /cso, npm audit fix
 * (never --force) in every lockfile, as a PR. Writes a digest, a repo flag and a request row, so it
 * runs on the throwaway Neon branch only.
 */
import { test, expect } from '@playwright/test'
import { neon } from '@neondatabase/serverless'
import { FACTORY_OWNER, NOT_FACTORY_OWNER, getNonFactoryRepo } from './helpers/factory'
import { DISPOSABLE_DB, DISPOSABLE_DB_REASON } from './helpers/disposable-db'

const sql = () => neon(process.env.DATABASE_URL ?? '')
const MARK = 'e2e-fix-it'

test.describe('Advisor: Fix it', () => {
  test.skip(!DISPOSABLE_DB, DISPOSABLE_DB_REASON)
  let repo: { id: number; name: string } | null = null
  let digestId: number | null = null

  test.beforeAll(async () => {
    repo = await getNonFactoryRepo()
    if (!repo) return
    await sql()`UPDATE repositories SET factory_enabled = false WHERE id = ${repo.id}`
    const now = new Date().toISOString()
    const advisor = {
      headline: MARK, portfolioInsight: MARK, totalValueUnlocked: MARK, generatedAt: now,
      actions: [{ repoId: repo.id, repoName: repo.name, action: `Resolve 131 critical and high security alerts in ${repo.name}`, impactType: 'security', estimatedImpact: '+12pts opportunity score points', effort: 'substantial', reasoning: `${MARK}: vulnerable dependencies.` }],
    }
    const [row] = await sql()`INSERT INTO digests (user_id, content, advisor_content, generated_at)
      VALUES (${FACTORY_OWNER}, ${JSON.stringify({ summary: MARK, priorities: [], generatedAt: now })}::jsonb, ${JSON.stringify(advisor)}::jsonb, now()) RETURNING id`
    digestId = row.id as number
  })

  test.afterAll(async () => {
    if (!repo) return
    await sql()`DELETE FROM agent_requests WHERE skill = 'cso' AND repo ILIKE ${`%/${repo.name}`}`
    if (digestId) await sql()`DELETE FROM digests WHERE id = ${digestId}`
    await sql()`UPDATE repositories SET factory_enabled = false WHERE id = ${repo.id}`
  })

  test('the owner opens the repo to the factory, then "Fix it" queues the safe security fix', async ({ page }) => {
    if (!repo) { test.skip(true, NOT_FACTORY_OWNER); return }
    await page.goto(`/repos/${repo.id}`)
    await page.getByRole('tab', { name: /Agent/i }).click()

    // Not open to the factory yet: the Advisor and the launcher say so, and offer to open it.
    await expect(page.getByText(`Resolve 131 critical and high security alerts in ${repo.name}`).first()).toBeVisible()
    await expect(page.getByRole('button', { name: 'Fix it' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Let the factory work on this repo' }).first().click()
    await expect(page.getByText(/The factory can work on .+ now/)).toBeVisible()
    const [flag] = await sql()`SELECT factory_enabled FROM repositories WHERE id = ${repo.id}`
    expect(flag.factory_enabled).toBe(true)

    // Open now: a security item is "Fix it", which queues /cso as a fix (REDIS_URL is empty in the
    // e2e run, so the request stays in this throwaway database and no worker runs it).
    const fix = page.getByRole('button', { name: 'Fix it' }).first()
    await expect(fix).toBeVisible()
    await fix.click()
    await expect(page.getByText('Queued for the factory')).toBeVisible()
    await expect.poll(async () => {
      const rows = await sql()`SELECT skill, mode, source FROM agent_requests WHERE skill = 'cso' AND repo ILIKE ${`%/${repo!.name}`} ORDER BY created_at DESC LIMIT 1`
      return rows[0] ?? null
    }).toMatchObject({ skill: 'cso', mode: 'fix', source: 'ui-advisor' })
  })
})
