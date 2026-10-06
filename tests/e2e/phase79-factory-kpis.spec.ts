/**
 * Phase 79 — Factory KPIs on /agent-performance, from the `agent_jobs` job record.
 *
 * Covers:
 * - The KPI cards render when the user has factory jobs
 * - Merged / closed counts move by exactly what was seeded (relative to what was already there)
 * - The overnight-yield card counts nights the factory ran
 *
 * Seeds agent_jobs rows (as factory/lib/sink.ts writes them) for the signed-in test user and
 * deletes them afterwards. Run `npm run factory:migrate` first if the table doesn't exist.
 */
import { test, expect, type Page } from '@playwright/test'
import { neon } from '@neondatabase/serverless'

const DB_URL = process.env.DATABASE_URL ?? ''
const PREFIX = `phase79-kpi-${Date.now()}`

async function userId(): Promise<string | null> {
  const sql = neon(DB_URL)
  const [user] = await sql`SELECT id FROM users LIMIT 1`
  return (user?.id as string | undefined) ?? null
}

async function tableExists(): Promise<boolean> {
  const sql = neon(DB_URL)
  const [r] = await sql`SELECT to_regclass('public.agent_jobs') AS t`
  return r?.t !== null
}

async function seedJob(uid: string, n: number, opts: { outcome: 'merged' | 'rejected' | null; hoursAgo: number; humanCommits?: number }) {
  const sql = neon(DB_URL)
  await sql`
    INSERT INTO agent_jobs (id, user_id, repo, run_id, task_kind, tier, model, harness, status, requests, pr_url, outcome, human_commits, started_at, resolved_at)
    VALUES (${`${PREFIX}-${n}`}, ${uid}, 'smithdavedesign/kpi-fixture', ${PREFIX}, 'fix-types', 'M1', 'free-agent', 'claude-code', 'verified', 10,
            ${`https://github.com/smithdavedesign/kpi-fixture/pull/${n}`}, ${opts.outcome}, ${opts.humanCommits ?? 0},
            NOW() - make_interval(hours => ${opts.hoursAgo}), ${opts.outcome ? sql`NOW() - make_interval(hours => ${opts.hoursAgo - 2})` : null})
  `
}

async function cleanup() {
  if (!DB_URL) return
  const sql = neon(DB_URL)
  if (await tableExists()) await sql`DELETE FROM agent_jobs WHERE id LIKE ${PREFIX + '%'}`
}

/** "3 merged · 1 closed" from the Acceptance card's hint. */
async function counts(page: Page): Promise<{ merged: number; closed: number }> {
  const text = (await page.getByTestId('factory-kpis').textContent()) ?? ''
  const m = /(\d+) merged · (\d+) closed/.exec(text)
  return m ? { merged: Number(m[1]), closed: Number(m[2]) } : { merged: 0, closed: 0 }
}

test.describe('Agent Performance — factory KPIs (Phase 79)', () => {
  test.afterEach(cleanup)

  test('KPI cards render from agent_jobs and count seeded outcomes', async ({ page }) => {
    test.skip(!DB_URL, 'DATABASE_URL not set')
    test.skip(!(await tableExists()), 'agent_jobs missing — run npm run factory:migrate')
    const uid = await userId()
    if (!uid) { test.skip(true, 'No user'); return }

    await page.goto('/agent-performance')
    const hadKpis = await page.getByTestId('factory-kpis').isVisible().catch(() => false)
    const before = hadKpis ? await counts(page) : { merged: 0, closed: 0 }

    await seedJob(uid, 1, { outcome: 'merged', hoursAgo: 30 })
    await seedJob(uid, 2, { outcome: 'merged', hoursAgo: 6, humanCommits: 1 })
    await seedJob(uid, 3, { outcome: 'rejected', hoursAgo: 5 })
    await seedJob(uid, 4, { outcome: null, hoursAgo: 4 })

    await page.goto('/agent-performance')
    const kpis = page.getByTestId('factory-kpis')
    await expect(kpis).toBeVisible({ timeout: 8000 })
    for (const label of ['Overnight yield', 'Acceptance', 'Per 100 free requests', 'Review time', 'Autonomy']) {
      await expect(kpis.getByText(label, { exact: true })).toBeVisible()
    }
    expect(await counts(page)).toEqual({ merged: before.merged + 2, closed: before.closed + 1 })
    await expect(kpis).toContainText(/approved PRs\/night · \d+ night\(s\)/)
  })

  test('the KPI section stays alongside the factory tier table', async ({ page }) => {
    test.skip(!DB_URL, 'DATABASE_URL not set')
    test.skip(!(await tableExists()), 'agent_jobs missing — run npm run factory:migrate')
    const uid = await userId()
    if (!uid) { test.skip(true, 'No user'); return }

    await seedJob(uid, 1, { outcome: 'merged', hoursAgo: 10 })
    await page.goto('/agent-performance')
    await expect(page.getByText(/Factory KPIs \(last 30 days\)/)).toBeVisible({ timeout: 8000 })
    await expect(page.getByRole('heading', { name: 'Agent Performance' })).toBeVisible()
  })
})
