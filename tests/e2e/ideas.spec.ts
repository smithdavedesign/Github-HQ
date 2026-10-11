/**
 * The Ideas page (docs/idea-factory.md): the owner reviews ideas the pipeline synced and decides
 * Build / Demand test / Pass; the decision becomes a pending idea_decisions row for the pipeline.
 *
 * Disposable branch only (npm run test:e2e pushes the schema there): it seeds `e2e-` ideas and
 * removes them and their decisions afterwards.
 */
import { test, expect } from '@playwright/test'
import { neon } from '@neondatabase/serverless'
import { DISPOSABLE_DB, DISPOSABLE_DB_REASON } from './helpers/disposable-db'
import { FACTORY_OWNER, NOT_FACTORY_OWNER } from './helpers/factory'

const DB_URL = process.env.DATABASE_URL ?? ''
const sql = () => neon(DB_URL)
const SLUG = 'e2e-idea-alpha'
const SLUG2 = 'e2e-idea-beta'

async function ready(): Promise<string | null> {
  if (!DISPOSABLE_DB) return DISPOSABLE_DB_REASON
  if (!FACTORY_OWNER) return NOT_FACTORY_OWNER
  const [row] = await sql()`SELECT to_regclass('public.ideas') IS NOT NULL AND to_regclass('public.idea_decisions') IS NOT NULL AS ok`
  return row?.ok ? null : 'the ideas tables are not in this database (npm run db:push)'
}

async function seed(slug: string, title: string, score: number) {
  const at = new Date(Date.now() - 3600_000).toISOString()
  const state = { stage: 'pass', review: { verdict: 'pass', score, summary: `Review summary for ${title}.`, at } }
  const review = {
    verdict: 'pass', score, summary: `Review summary for ${title}.`,
    forcingQuestions: { demand: { score: 3, evidence: 'One forum thread.' }, wedge: { score: 7, evidence: 'Clear wedge.' } },
    risks: ['Thin demand'], killCriteria: 'Fewer than 5 signups.', feasibility: { zeroCost: true, m1Weekend: true, notes: 'Static site' },
    landing: { headline: 'H', subhead: 'S', bullets: ['b'], cta: 'Join' }, launch: { channels: [{ name: 'r/test' }], post: 'Try {url}' },
  }
  const docs = { prd: `# PRD\n\n## Problem\n\nThe **${title}** problem.\n\n<script>window.__pwned = true</script>\n\n[bad](javascript:alert(1))`, research: '# Research\n\nNotes.' }
  await sql()`INSERT INTO ideas (slug, title, stage, idea, state, review, docs, notion_url, hash, updated_at)
    VALUES (${slug}, ${`${title} — a test idea`}, 'pass', ${JSON.stringify({ oneLiner: 'x', effort: 'Low', sources: ['https://example.com/a'] })}::jsonb,
      ${JSON.stringify(state)}::jsonb, ${JSON.stringify(review)}::jsonb, ${JSON.stringify(docs)}::jsonb, 'https://www.notion.so/e2e', 'e2e', now())
    ON CONFLICT (slug) DO NOTHING`
}

async function cleanup() {
  if (!DB_URL) return
  await sql()`DELETE FROM idea_decisions WHERE slug IN (${SLUG}, ${SLUG2})`.catch(() => {})
  await sql()`DELETE FROM ideas WHERE slug IN (${SLUG}, ${SLUG2})`.catch(() => {})
}

test.describe('Ideas page', () => {
  test.beforeAll(async () => {
    if (await ready()) return
    await cleanup()
    await seed(SLUG, 'Alpha', 8)
    await seed(SLUG2, 'Beta', 5)
  })
  test.afterAll(cleanup)

  test('lists ideas that need a call and opens the review', async ({ page }) => {
    const skip = await ready()
    test.skip(!!skip, skip ?? '')
    await page.goto('/ideas')
    await expect(page.getByRole('heading', { name: 'Ideas', level: 1 })).toBeVisible()
    const section = page.locator('section', { has: page.getByRole('heading', { name: /Needs your call/ }) })
    await expect(section.getByRole('link', { name: 'Alpha' })).toBeVisible()
    await section.getByRole('link', { name: 'Alpha' }).click()
    await expect(page).toHaveURL(new RegExp(`/ideas/${SLUG}$`))
    await expect(page.getByText('Review summary for Alpha.').first()).toBeVisible()
    await expect(page.getByText('The Alpha problem.')).toBeVisible()
    // Model-written markdown never runs scripts or javascript: links.
    expect(await page.evaluate(() => (window as unknown as { __pwned?: boolean }).__pwned)).toBeUndefined()
    await expect(page.getByRole('link', { name: 'bad' })).toHaveCount(0)
  })

  test('approving queues a decision for the pipeline, and it can be withdrawn', async ({ page }) => {
    const skip = await ready()
    test.skip(!!skip, skip ?? '')
    await page.goto(`/ideas/${SLUG}`)
    await page.getByRole('button', { name: /Approve build/ }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByText(/Creates the private repo e2e-idea-alpha/)).toBeVisible()
    await dialog.getByRole('textbox').fill('e2e: overruling the review')
    await dialog.getByRole('button', { name: /Approve build/ }).click()
    // A decision moves on to the next idea in the review queue.
    await expect(page).toHaveURL(new RegExp(`/ideas/(?!${SLUG}$)`))
    const [d] = await sql()`SELECT decision, status, note FROM idea_decisions WHERE slug = ${SLUG} ORDER BY id DESC LIMIT 1`
    expect(d).toMatchObject({ decision: 'build', status: 'pending', note: 'e2e: overruling the review' })

    await page.goto(`/ideas/${SLUG}`)
    await expect(page.getByText(/Approve build queued/).first()).toBeVisible()
    await page.getByRole('button', { name: /Withdraw/ }).click()
    await expect(page.getByText(/Approve build queued/)).toHaveCount(0)
    const [w] = await sql()`SELECT status FROM idea_decisions WHERE slug = ${SLUG} ORDER BY id DESC LIMIT 1`
    expect(w.status).toBe('cancelled')
  })

  test('keyboard shortcuts open the confirm dialog, only for decisions the idea allows', async ({ page }) => {
    const skip = await ready()
    test.skip(!!skip, skip ?? '')
    await page.goto(`/ideas/${SLUG2}`)
    await page.waitForLoadState('networkidle') // the shortcuts attach on hydration
    // On an idea the review passed, P means "agree, keep passed"; A is the overrule.
    await page.keyboard.press('p')
    await expect(page.getByRole('dialog').getByRole('heading', { name: /Agree, keep passed: Beta/ })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.keyboard.press('t')
    await expect(page.getByRole('dialog').getByRole('heading', { name: /Demand test first: Beta/ })).toBeVisible()
    await page.keyboard.press('Escape')
  })
})
