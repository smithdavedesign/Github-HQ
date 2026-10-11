/**
 * The Ideas page (docs/idea-factory.md): the owner reviews ideas the pipeline synced and decides
 * Build / Demand test / Pass; the decision becomes a pending idea_decisions row for the pipeline.
 * "Start build now" on an approved idea queues an idea_build_requests row the same way.
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
const SLUG3 = 'e2e-idea-gamma'

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

/** An approved idea whose repo exists and isn't built yet: what "Start build now" is for. */
async function seedApproved(slug: string, title: string) {
  const state = { stage: 'repo', repo: `https://github.com/smithdavedesign/${slug}`, ownerApproved: true, review: { verdict: 'pass', score: 4, at: new Date().toISOString() } }
  const docs = { prd: '# PRD\n\nGamma.', roadmap: '# Roadmap\n\n## M1 — core\n\nExit: it works.\n\n## M2 — more\n\nExit: more works.' }
  await sql()`INSERT INTO ideas (slug, title, stage, idea, state, review, docs, notion_url, hash, updated_at)
    VALUES (${slug}, ${`${title} — an approved test idea`}, 'repo', ${JSON.stringify({ oneLiner: 'x' })}::jsonb, ${JSON.stringify(state)}::jsonb,
      ${JSON.stringify({ verdict: 'pass', score: 4 })}::jsonb, ${JSON.stringify(docs)}::jsonb, 'https://www.notion.so/e2e', 'e2e', now())
    ON CONFLICT (slug) DO NOTHING`
}

async function buildReady(): Promise<string | null> {
  const base = await ready()
  if (base) return base
  const [row] = await sql()`SELECT to_regclass('public.idea_build_requests') IS NOT NULL AS ok`
  return row?.ok ? null : 'idea_build_requests is not in this database (npm run db:push)'
}

async function cleanup() {
  if (!DB_URL) return
  await sql()`DELETE FROM idea_build_requests WHERE slug IN (${SLUG}, ${SLUG2}, ${SLUG3})`.catch(() => {})
  await sql()`DELETE FROM idea_decisions WHERE slug IN (${SLUG}, ${SLUG2}, ${SLUG3})`.catch(() => {})
  await sql()`DELETE FROM ideas WHERE slug IN (${SLUG}, ${SLUG2}, ${SLUG3})`.catch(() => {})
  await sql()`DELETE FROM idea_seeds WHERE text LIKE 'e2e:%'`.catch(() => {})
}

test.describe('Ideas page', () => {
  test.beforeAll(async () => {
    if (await ready()) return
    await cleanup()
    await seed(SLUG, 'Alpha', 8)
    await seed(SLUG2, 'Beta', 5)
    await seedApproved(SLUG3, 'Gamma')
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

  test('a new idea joins the research queue and can be withdrawn before the pipeline takes it', async ({ page }) => {
    const skip = await ready()
    test.skip(!!skip, skip ?? '')
    await page.goto('/ideas')
    await page.getByRole('textbox', { name: /New idea/ }).fill('e2e: a tool that warns co-hosts about rule changes')
    await page.getByRole('button', { name: /Queue for research/ }).click()
    await expect(page.getByText('Waiting for the pipeline (within 15 min)')).toBeVisible()
    const [row] = await sql()`SELECT status FROM idea_seeds WHERE text = 'e2e: a tool that warns co-hosts about rule changes'`
    expect(row.status).toBe('pending')
    await page.getByRole('button', { name: /Withdraw/ }).click()
    await expect(page.getByText('e2e: a tool that warns co-hosts')).toHaveCount(0)
  })

  test('Start build now queues the next milestone for the pipeline, and it can be withdrawn', async ({ page }) => {
    const skip = await buildReady()
    test.skip(!!skip, skip ?? '')
    await page.goto(`/ideas/${SLUG3}`)
    await page.getByRole('button', { name: /Start M1 build now/ }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: /Start M1 build now: Gamma/ })).toBeVisible()
    await expect(dialog.getByText(/builds M1 in smithdavedesign\/e2e-idea-gamma, without waiting for the weekly build slot/)).toBeVisible()
    await expect(dialog.getByText(/at effort xhigh/)).toBeVisible()
    await expect(dialog.getByText(/plan-eng-review first/)).toBeVisible()
    await dialog.getByRole('textbox', { name: /Note for the builder/ }).fill('e2e: CLI first')
    await dialog.getByRole('button', { name: /^Start M1 build(?! now)/ }).click()
    await expect(page.getByText('Queued: starts on the pipeline’s next run (within 15 min)')).toBeVisible()
    await expect(page.getByRole('button', { name: /Start M1 build now/ })).toHaveCount(0)
    const [r] = await sql()`SELECT milestone, status, note FROM idea_build_requests WHERE slug = ${SLUG3} ORDER BY id DESC LIMIT 1`
    expect(r).toMatchObject({ milestone: 'M1', status: 'pending', note: 'e2e: CLI first' })

    await page.getByRole('button', { name: /Withdraw/ }).click()
    await expect(page.getByText('Withdrawn')).toBeVisible()
    await expect(page.getByRole('button', { name: /Start M1 build now/ })).toBeEnabled()
    const [w] = await sql()`SELECT status FROM idea_build_requests WHERE slug = ${SLUG3} ORDER BY id DESC LIMIT 1`
    expect(w.status).toBe('cancelled')
  })

  test('a running build shows its engine and offers no second start; unbuildable ideas get no button', async ({ page }) => {
    const skip = await buildReady()
    test.skip(!!skip, skip ?? '')
    const [u] = await sql()`SELECT id FROM users LIMIT 1`
    await sql()`INSERT INTO idea_build_requests (slug, user_id, milestone, status, engine, started_at, result)
      VALUES (${SLUG3}, ${u.id}, 'M1', 'running', 'claude-opus-5-5 · xhigh', now(), 'building M1')`
    await page.goto(`/ideas/${SLUG3}`)
    await expect(page.getByText('Building M1 now (claude-opus-5-5 · xhigh)')).toBeVisible()
    await expect(page.getByRole('button', { name: /Start .*build now/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Withdraw/ })).toHaveCount(0)
    await sql()`DELETE FROM idea_build_requests WHERE slug = ${SLUG3}`

    // A passed idea without a repo has no Build card at all.
    await page.goto(`/ideas/${SLUG2}`)
    await expect(page.getByRole('heading', { name: /Beta/ }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: /build now/ })).toHaveCount(0)
  })
})
