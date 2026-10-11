/**
 * The Agents page's idea pipeline panel and Subscriptions cards (src/components/agents/usage-cards.tsx),
 * fed by system_events: idea-factory's research/review/build/claude events and the factory's
 * factory/copilot/usage snapshot. Disposable branch only (npm run test:e2e): it writes `e2e:` events
 * and removes them afterwards.
 */
import { test, expect } from '@playwright/test'
import { neon } from '@neondatabase/serverless'
import { DISPOSABLE_DB, DISPOSABLE_DB_REASON } from './helpers/disposable-db'
import { FACTORY_OWNER, NOT_FACTORY_OWNER } from './helpers/factory'

const sql = () => neon(process.env.DATABASE_URL ?? '')
const IDEA = 'e2e-usage-idea'
const SEEDED = 'e2e-usage-seeded'

async function event(minutesAgo: number, e: { system: string; component: string; event: string; status: string; message: string; subject?: object; data?: object; durationMs?: number }) {
  await sql()`INSERT INTO system_events (ts, system, component, event, status, level, message, subject, data, duration_ms, host, fingerprint)
    VALUES (now() - make_interval(mins => ${minutesAgo}), ${e.system}, ${e.component}, ${e.event}, ${e.status}, 'info', ${e.message},
      ${e.subject ? JSON.stringify(e.subject) : null}::jsonb, ${e.data ? JSON.stringify(e.data) : null}::jsonb, ${e.durationMs ?? null}, 'e2e', ${`${e.system}:${e.component}:${e.event}`})`
}

async function cleanup() {
  if (!process.env.DATABASE_URL) return
  await sql()`DELETE FROM system_events WHERE host = 'e2e' AND message LIKE 'e2e:%'`.catch(() => {})
}

test.describe('Agents page: idea pipeline and subscriptions', () => {
  test.beforeAll(async () => {
    if (!DISPOSABLE_DB || !FACTORY_OWNER) return
    await cleanup()
    await event(5, { system: 'idea-factory', component: 'build', event: 'M1', status: 'start', message: 'e2e: M1 started (Start build now) on opus at xhigh',
      subject: { idea: IDEA }, data: { milestone: 'M1', manual: true, model: 'opus', effort: 'xhigh' } })
    await event(30, { system: 'idea-factory', component: 'research', event: 'run', status: 'ok', message: `e2e: recorded ${SEEDED} on claude-sonnet-5-5 (seeded)`,
      subject: { idea: SEEDED }, data: { model: 'claude-sonnet-5-5', engine: 'claude', trigger: 'seed' }, durationMs: 90_000 })
    await event(1, { system: 'idea-factory', component: 'claude', event: 'capacity', status: 'info', message: "e2e: Claude subscription couldn't take the work: usage limit reached",
      data: { model: 'opus', fallback: true } })
    await event(0, { system: 'factory', component: 'copilot', event: 'usage', status: 'info', message: 'e2e: Copilot snapshot',
      data: { installed: true, plan: 'individual_pro', percentRemaining: 63.4, overagePermitted: false, resetDate: '2026-11-01', tasksToday: 2, maxTasksPerDay: 6, reviewsToday: 1, maxReviewsPerDay: 4 } })
  })
  test.afterAll(cleanup)

  test.beforeEach(() => {
    test.skip(!DISPOSABLE_DB, DISPOSABLE_DB_REASON)
    test.skip(!FACTORY_OWNER, NOT_FACTORY_OWNER)
  })

  test('the idea pipeline panel shows what is building, the caps and the latest runs', async ({ page }) => {
    await page.goto('/agent-performance')
    const panel = page.getByTestId('idea-pipeline')
    await expect(panel.getByRole('heading', { name: /Idea pipeline/ })).toBeVisible()
    const building = panel.getByTestId('idea-pipeline-building')
    await expect(building.getByRole('link', { name: IDEA })).toBeVisible()
    await expect(building).toContainText(/M1\s*started .* on opus at xhigh · Start build now/)
    const limits = panel.getByTestId('idea-pipeline-limits')
    await expect(limits).toContainText('Manual builds')
    await expect(limits).toContainText('Weekly build slot')
    await expect(limits).toContainText('Seeded research')
    const runs = panel.getByTestId('idea-pipeline-runs')
    await expect(runs.getByRole('link', { name: SEEDED })).toBeVisible()
    await expect(runs).toContainText('research · sent')
    await expect(runs).toContainText('1m 30s · claude-sonnet-5-5')
  })

  test('Subscriptions: Claude Pro use with the last capacity hit, and the Copilot snapshot', async ({ page }) => {
    await page.goto('/agent-performance')
    const claude = page.getByTestId('claude-usage')
    await expect(claude).toContainText('Claude Pro')
    await expect(claude).toContainText(/Last 24 h:\s*\d+ runs?/)
    await expect(claude).toContainText('Last time it couldn’t take the work')
    await expect(claude).toContainText('usage limit reached')
    const copilot = page.getByTestId('copilot-usage')
    await expect(copilot).toContainText('GitHub Copilot · individual_pro')
    await expect(copilot).toContainText('63% of premium requests left, resets 2026-11-01')
    await expect(copilot).toContainText('Today: 2/6 builder tasks · 1/4 reviews')
    await expect(copilot.getByRole('progressbar', { name: 'Copilot premium requests left' })).toHaveAttribute('aria-valuenow', '63')
  })
})
