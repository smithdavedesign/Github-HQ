/**
 * The Ideas page (docs/idea-factory.md): the owner reviews ideas the pipeline synced and decides
 * Build / Demand test / Pass; the decision becomes a pending idea_decisions row for the pipeline.
 * "Start build now" on an approved idea queues an idea_build_requests row the same way.
 *
 * Disposable branch only (npm run test:e2e pushes the schema there): it seeds `e2e-` ideas and
 * removes them and their decisions afterwards. It also sets the pipeline heartbeat's growth policy
 * (policy.growth.focus, policy.build.startNew) for the growth-loop tests, and puts the original back.
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
const SLUG4 = 'e2e-idea-delta'
const SLUG5 = 'e2e-idea-epsilon'
const ALL = [SLUG, SLUG2, SLUG3, SLUG4, SLUG5]

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
  const step = (id: string, label: string, owner: 'agent' | 'david', done: boolean, evidence = '') => ({ id, label, owner, done, evidence })
  const launch = {
    steps: [
      step('plan', 'Road-to-revenue plan written', 'agent', true, 'Indie devs · $9/month'), step('mvp', 'MVP built: every roadmap milestone merged', 'agent', false, '0/2 milestones merged'),
      step('deployed', 'Live on a free tier', 'agent', false), step('legal', 'Privacy policy and terms pages', 'agent', true, 'privacy ✓ · terms ✓'),
      step('price', 'Price: $9/month (from the plan)', 'david', true), step('payments', 'Stripe product created and mapped to the repo in RepoHQ', 'david', false),
      step('launched', 'Launch posted', 'david', false), step('firstUser', 'First user or signup', 'david', false), step('firstDollar', 'First payment', 'david', false),
    ],
    next: { id: 'mvp', label: 'MVP built: every roadmap milestone merged', owner: 'agent' }, done: 3, total: 9, buyer: 'Indie devs running agents overnight', price: '$9/month',
  }
  const state = { stage: 'repo', repo: `https://github.com/smithdavedesign/${slug}`, ownerApproved: true, review: { verdict: 'pass', score: 4, at: new Date().toISOString() }, launch }
  const docs = { prd: '# PRD\n\nGamma.', roadmap: '# Roadmap\n\n## M1 — core\n\nExit: it works.\n\n## M2 — more\n\nExit: more works.', revenue: '# Revenue plan\n\nIndie devs pay $9 a month for the digest.' }
  await sql()`INSERT INTO ideas (slug, title, stage, idea, state, review, docs, notion_url, hash, updated_at)
    VALUES (${slug}, ${`${title} — an approved test idea`}, 'repo', ${JSON.stringify({ oneLiner: 'x' })}::jsonb, ${JSON.stringify(state)}::jsonb,
      ${JSON.stringify({ verdict: 'pass', score: 4 })}::jsonb, ${JSON.stringify(docs)}::jsonb, 'https://www.notion.so/e2e', 'e2e', now())
    ON CONFLICT (slug) DO NOTHING`
}

/** A built idea: M1 merged, M2 left, priced by its plan. "Get it launch-ready" and "Build the MVP (M2)" apply. */
async function seedBuilt(slug: string, title: string) {
  const state = { stage: 'building', repo: `https://github.com/smithdavedesign/${slug}`, milestonesDone: ['M1'], build: { milestone: 'M1', status: 'merged' },
    funnel: { d7: { visit: 2, signup: 0, activate: 0, checkout: 0 }, prev7: { visit: 0 }, all: { visit: 2 }, seen: { visit: true } },
    launch: { steps: [], next: { id: 'mvp', label: 'MVP built: every roadmap milestone merged', owner: 'agent' }, done: 2, total: 10, price: '$12 once' } }
  const docs = { prd: '# PRD', roadmap: '# Roadmap\n\n## M1 — core\n\n## M2 — more' }
  await sql()`INSERT INTO ideas (slug, title, stage, idea, state, review, docs, notion_url, hash, updated_at)
    VALUES (${slug}, ${`${title} — a built test idea`}, 'building', ${JSON.stringify({ oneLiner: 'x' })}::jsonb, ${JSON.stringify(state)}::jsonb,
      ${JSON.stringify({ verdict: 'pass', score: 4 })}::jsonb, ${JSON.stringify(docs)}::jsonb, 'https://www.notion.so/e2e', 'e2e', now())
    ON CONFLICT (slug) DO NOTHING`
}

/** A live focus product in the growth loop: a funnel, an experiment decided, a growth PR waiting, a lesson learned. */
async function seedGrowth(slug: string, title: string) {
  const funnel = { at: new Date().toISOString(), d7: { visit: 12, signup: 0, activate: 1, checkout: 0 }, prev7: { visit: 3, signup: 0, activate: 0, checkout: 0 }, all: { visit: 15, signup: 0, activate: 1, checkout: 0 },
    seen: { visit: true, activate: true, checkout: false }, referrers7d: [{ host: 'google.com', visitors: 7 }, { host: 'direct', visitors: 5 }] }
  const pr = `https://github.com/smithdavedesign/${slug}/pull/4`
  const growth = { stage: 'acquire', bottleneck: '12 visitors this week, under 50', next: { kind: 'post', executor: 'owner' }, experiments: [
    { id: `${slug}-20261013-instrumentation`, kind: 'instrumentation', executor: 'build', hypothesis: 'Counting visits on every page, first uses and Buy clicks shows where visitors drop off.',
      metric: 'beacon', baseline: 0, target: 1, windowDays: 7, status: 'decided', decision: 'keep', createdAt: '2026-10-13T10:00:00Z' },
    { id: `${slug}-20261020-seo`, kind: 'seo', executor: 'build', hypothesis: 'Pages that answer what the buyer searches bring visitors from search.',
      metric: 'visit', baseline: 12, target: 50, windowDays: 28, status: 'proposed', createdAt: '2026-10-20T10:00:00Z', prUrl: pr },
  ] }
  const state = { stage: 'live', repo: `https://github.com/smithdavedesign/${slug}`, milestonesDone: ['M1', 'M2'], funnel, growth,
    build: { milestone: 'GROWTH', kind: 'seo', experiment: `${slug}-20261020-seo`, milestones: [], status: 'pr-open', prUrl: pr },
    launch: { steps: [], next: { id: 'payments', label: 'Stripe product created and mapped to the repo in RepoHQ', owner: 'david' }, done: 6, total: 10, price: '$5 once' } }
  const docs = { prd: '# PRD', roadmap: '# Roadmap\n\n## M1 — core\n\n## M2 — more', learnings: '# Learnings\n\n- 2026-10-20 · funnel beacon · keep: the beacon went live, and 1 visitor in 12 used the core action.' }
  await sql()`INSERT INTO ideas (slug, title, stage, idea, state, review, docs, notion_url, hash, updated_at)
    VALUES (${slug}, ${`${title} — a live test product`}, 'live', ${JSON.stringify({ oneLiner: 'x' })}::jsonb, ${JSON.stringify(state)}::jsonb,
      ${JSON.stringify({ verdict: 'pass', score: 4 })}::jsonb, ${JSON.stringify(docs)}::jsonb, 'https://www.notion.so/e2e', 'e2e', now())
    ON CONFLICT (slug) DO NOTHING`
}

/** The heartbeat's policy before the growth tests changed it (restored after). */
let savedPolicy: unknown = undefined

/** The growth loop's settings as the pipeline publishes them: Epsilon in focus, first builds held until it has traction, autonomy on. */
async function setGrowthPolicy() {
  const [p] = await sql()`SELECT policy FROM idea_pipeline WHERE id = 'main'`
  savedPolicy = p ? p.policy : null
  const base = (p?.policy ?? {}) as { build?: Record<string, unknown> }
  const policy = { ...base, build: { ...(base.build ?? {}), startNew: false }, growth: { focus: [SLUG5], minVisitorsPerWeek: 50 }, autonomy: { merge: true, revert: true } }
  await sql()`INSERT INTO idea_pipeline (id, tick_at, ok, errors, policy) VALUES ('main', now(), true, '[]'::jsonb, ${JSON.stringify(policy)}::jsonb)
    ON CONFLICT (id) DO UPDATE SET policy = EXCLUDED.policy`
}

async function buildReady(): Promise<string | null> {
  const base = await ready()
  if (base) return base
  const [row] = await sql()`SELECT to_regclass('public.idea_build_requests') IS NOT NULL AS ok`
  return row?.ok ? null : 'idea_build_requests is not in this database (npm run db:push)'
}

async function cleanup() {
  if (!DB_URL) return
  await sql()`DELETE FROM idea_build_requests WHERE slug = ANY(${ALL})`.catch(() => {})
  await sql()`DELETE FROM idea_decisions WHERE slug = ANY(${ALL})`.catch(() => {})
  await sql()`DELETE FROM ideas WHERE slug = ANY(${ALL})`.catch(() => {})
  if (savedPolicy !== undefined) {
    if (savedPolicy === null) await sql()`DELETE FROM idea_pipeline WHERE id = 'main'`.catch(() => {})
    else await sql()`UPDATE idea_pipeline SET policy = ${JSON.stringify(savedPolicy)}::jsonb WHERE id = 'main'`.catch(() => {})
    savedPolicy = undefined
  }
  await sql()`DELETE FROM idea_seeds WHERE text LIKE 'e2e:%'`.catch(() => {})
}

test.describe('Ideas page', () => {
  test.beforeAll(async () => {
    if (await ready()) return
    await cleanup()
    // The branch copies production, whose real builds today would hit the manual cap and change every dialog. Age them (disposable branch only: ready() checks).
    await sql()`UPDATE idea_build_requests SET started_at = started_at - interval '2 days' WHERE started_at > now() - interval '1 day'`
    await seed(SLUG, 'Alpha', 8)
    await seed(SLUG2, 'Beta', 5)
    await seedApproved(SLUG3, 'Gamma')
    await seedBuilt(SLUG4, 'Delta')
    await seedGrowth(SLUG5, 'Epsilon')
    await setGrowthPolicy()
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

  test('Just M1 queues one milestone for the pipeline, and it can be withdrawn', async ({ page }) => {
    const skip = await buildReady()
    test.skip(!!skip, skip ?? '')
    await page.goto(`/ideas/${SLUG3}`)
    await page.getByRole('button', { name: 'Just M1' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: /Start M1 build now: Gamma/ })).toBeVisible()
    await expect(dialog.getByText(/builds M1 in smithdavedesign\/e2e-idea-gamma, without waiting for the weekly build slot/)).toBeVisible()
    await expect(dialog.getByText(/at effort xhigh/)).toBeVisible()
    await expect(dialog.getByText(/plan-eng-review first/)).toBeVisible()
    await dialog.getByRole('textbox', { name: /Note for the builder/ }).fill('e2e: CLI first')
    await dialog.getByRole('button', { name: /^Start M1 build(?! now)/ }).click()
    await expect(page.getByText('Queued: starts on the pipeline’s next run (within 15 min)')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Just M1' })).toHaveCount(0)
    const [r] = await sql()`SELECT milestone, status, note FROM idea_build_requests WHERE slug = ${SLUG3} ORDER BY id DESC LIMIT 1`
    expect(r).toMatchObject({ milestone: 'M1', status: 'pending', note: 'e2e: CLI first' })

    await page.getByRole('button', { name: /Withdraw/ }).click()
    await expect(page.getByText('Withdrawn')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Just M1' })).toBeEnabled()
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
    await expect(page.getByRole('button', { name: /build now|Build the MVP|Just M1/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Withdraw/ })).toHaveCount(0)
    await sql()`DELETE FROM idea_build_requests WHERE slug = ${SLUG3}`

    // A passed idea without a repo has no Build card at all.
    await page.goto(`/ideas/${SLUG2}`)
    await expect(page.getByRole('heading', { name: /Beta/ }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: /build now/ })).toHaveCount(0)
  })

  test('Build the MVP queues every remaining milestone as one request', async ({ page }) => {
    const skip = await buildReady()
    test.skip(!!skip, skip ?? '')
    await sql()`DELETE FROM idea_build_requests WHERE slug = ${SLUG3}`
    await page.goto(`/ideas/${SLUG3}`)
    await page.getByRole('button', { name: 'Build the MVP (M1–M2)' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: /Build the MVP \(M1–M2\): Gamma/ })).toBeVisible()
    await expect(dialog.getByText(/builds M1, M2 one after another in smithdavedesign\/e2e-idea-gamma/)).toBeVisible()
    await expect(dialog.getByText(/stops at the first milestone whose tests fail/)).toBeVisible()
    await dialog.getByRole('button', { name: /^Build the MVP(?! \()/ }).click()
    await expect(page.getByText('Queued: starts on the pipeline’s next run (within 15 min)')).toBeVisible()
    const [r] = await sql()`SELECT milestone, status FROM idea_build_requests WHERE slug = ${SLUG3} ORDER BY id DESC LIMIT 1`
    expect(r).toMatchObject({ milestone: 'MVP', status: 'pending' })
    await page.getByRole('button', { name: /Withdraw/ }).click()
    await expect(page.getByText('Withdrawn')).toBeVisible()
  })

  test('Road to revenue shows the steps to the first dollar, whose step is next, and the plan', async ({ page }) => {
    const skip = await buildReady()
    test.skip(!!skip, skip ?? '')
    await page.goto(`/ideas/${SLUG3}`)
    const card = page.getByTestId('revenue-card')
    await expect(card.getByText('3 of 9 steps to the first dollar')).toBeVisible()
    await expect(card.getByText('$9/month', { exact: true })).toBeVisible()
    await expect(card.getByText('Who pays:')).toBeVisible()
    await expect(card.getByText(/Indie devs running agents overnight/)).toBeVisible()
    await expect(card.getByTestId('revenue-next')).toContainText('MVP built: every roadmap milestone merged')
    await expect(card.getByTestId('revenue-next')).toContainText('agents')
    await expect(card.getByText('Stripe product created and mapped to the repo in RepoHQ')).toBeVisible()
    await page.getByRole('tab', { name: 'Revenue plan' }).click()
    await expect(page.getByText('Indie devs pay $9 a month for the digest.')).toBeVisible()
  })

  test('Get it launch-ready queues a go-live for a built idea, and says what it adds', async ({ page }) => {
    const skip = await buildReady()
    test.skip(!!skip, skip ?? '')
    await page.goto(`/ideas/${SLUG4}`)
    await expect(page.getByRole('button', { name: 'Start M2 build now' })).toBeVisible()
    await page.getByRole('button', { name: 'Get it launch-ready' }).click()
    const dialog = page.getByRole('dialog')
    await expect(dialog.getByRole('heading', { name: /Get it launch-ready: Delta/ })).toBeVisible()
    await expect(dialog.getByText(/sitemap\.xml, robots\.txt and structured data/)).toBeVisible()
    await expect(dialog.getByText(/A Buy button for \$12 once/)).toBeVisible()
    await dialog.getByRole('button', { name: /^Make it launch-ready/ }).click()
    await expect(page.getByText('Queued: starts on the pipeline’s next run (within 15 min)')).toBeVisible()
    const [r] = await sql()`SELECT milestone, status FROM idea_build_requests WHERE slug = ${SLUG4} ORDER BY id DESC LIMIT 1`
    expect(r).toMatchObject({ milestone: 'GOLIVE', status: 'pending' })
    await expect(page.getByRole('button', { name: 'Get it launch-ready' })).toHaveCount(0)
    await page.getByRole('button', { name: /Withdraw/ }).click()
    await expect(page.getByText('Withdrawn')).toBeVisible()
  })

  test('the new-build hold: an approved idea that was never built says its first build waits for traction', async ({ page }) => {
    const skip = await buildReady()
    test.skip(!!skip, skip ?? '')
    await page.goto(`/ideas/${SLUG3}`)
    await expect(page.getByText(`M1 not started: new builds wait until ${SLUG5} has 50 visitors a week. Start build now still works.`)).toBeVisible()
    await expect(page.getByRole('button', { name: 'Just M1' })).toBeVisible()
    await page.goto('/ideas')
    await expect(page.getByText(/new ideas wait for traction/)).toBeVisible()
  })

  test("the Growth card shows a focus product's funnel, the loop's stage and next mission, and its experiments", async ({ page }) => {
    const skip = await ready()
    test.skip(!!skip, skip ?? '')
    await page.goto(`/ideas/${SLUG5}`)
    const card = page.getByTestId('growth-card')
    await expect(card.getByTestId('growth-funnel')).toHaveText('12 visitors this week (3 the week before), 1 activation, 0 Buy clicks')
    await expect(card.getByText('Sources this week: google.com 7, direct 5')).toBeVisible()
    await expect(card.getByText(/^Old beacon: only home-page views/), 'its beacon sends visits').toHaveCount(0)
    await expect(card.getByText(/Getting visitors:/)).toBeVisible()
    await expect(card.getByTestId('growth-next')).toContainText('yours: post the next kit channel')
    await expect(card.getByText('search pages · PR open · 12 visitors a week → 50 visitors a week')).toBeVisible()
    await expect(card.getByText(/funnel beacon · decided: keep · old beacon → beacon live/)).toBeVisible()
    await expect(card.getByRole('link', { name: 'PR' })).toHaveAttribute('href', `https://github.com/smithdavedesign/${SLUG5}/pull/4`)
    // The Build card names the growth PR; a live product offers no milestone builds.
    await expect(page.getByText('Growth PR pr-open: search pages, one change to test one idea.')).toBeVisible()
    await expect(page.getByText('The pipeline merges it once its checks pass.'), 'autonomy: nothing for the owner to do').toBeVisible()
    await expect(page.getByRole('button', { name: /build now|Build the MVP|Just M1/ })).toHaveCount(0)
    // A product with a funnel that isn't a focus product is measured, not worked on.
    await page.goto(`/ideas/${SLUG4}`)
    await expect(page.getByTestId('growth-card').getByTestId('growth-funnel')).toHaveText('2 visitors this week (0 the week before), 0 activations, 0 Buy clicks')
    await expect(page.getByTestId('growth-card').getByText(/Not a focus product/)).toBeVisible()
  })

  test('the Learnings tab shows what a product learned from its experiments', async ({ page }) => {
    const skip = await ready()
    test.skip(!!skip, skip ?? '')
    await page.goto(`/ideas/${SLUG5}`)
    await page.getByRole('tab', { name: 'Learnings' }).click()
    await expect(page.getByText(/the beacon went live, and 1 visitor in 12 used the core action/)).toBeVisible()
    // An idea without lessons has no Learnings tab.
    await page.goto(`/ideas/${SLUG4}`)
    await expect(page.getByRole('tab', { name: 'Learnings' })).toHaveCount(0)
  })
})
