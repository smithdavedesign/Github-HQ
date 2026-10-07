/**
 * Agent HQ (roadmap Phase 81, docs/agent-hq-migration-prd.md §9): the Agents page's automation
 * panel, requests and traces; the status API for factory requests; the settings card.
 *
 * Runs against .env.local's DATABASE_URL (production): every row seeded here has an `e2e-` id
 * and is deleted afterwards (trace_events go with their automation_runs row by cascade).
 */
import { test, expect } from '@playwright/test'
import { neon } from '@neondatabase/serverless'
import { randomUUID } from 'node:crypto'
import { FACTORY_OWNER, getFactoryRepo, NOT_FACTORY_OWNER } from './helpers/factory'

const DB_URL = process.env.DATABASE_URL ?? ''

async function tablesExist(): Promise<boolean> {
  if (!DB_URL) return false
  const [row] = await neon(DB_URL)`SELECT to_regclass('public.agent_requests') IS NOT NULL AND to_regclass('public.trace_events') IS NOT NULL AS ok`
  return Boolean(row?.ok)
}

interface Seeded { requestId: string; runId: string }

async function seedReportedRequest(repo: { id: number; name: string }): Promise<Seeded> {
  const sql = neon(DB_URL)
  const requestId = `e2e-${randomUUID()}`
  const runId = `e2e-${randomUUID()}`
  const [r] = await sql`SELECT full_name FROM repositories WHERE id = ${repo.id}`
  await sql`
    INSERT INTO agent_requests (id, user_id, repo_id, repo, mode, skill, objective, source, status, findings, attempts, created_at, claimed_at, resolved_at, updated_at)
    VALUES (${requestId}, ${FACTORY_OWNER}, ${repo.id}, ${r.full_name}, 'report', 'review', ${'E2E review of the auth flow ' + requestId}, 'ui-skill', 'reported',
            ${'## Summary\nOne issue.\n## Findings\n- src/auth.ts:10 — token logged'}, 1, NOW() - INTERVAL '5 minutes', NOW() - INTERVAL '4 minutes', NOW(), NOW())`
  await sql`
    INSERT INTO automation_runs (id, user_id, kind, trigger, request_id, status, started_at, finished_at)
    VALUES (${runId}, ${FACTORY_OWNER}, 'factory-request', 'request', ${requestId}, 'ok', NOW() - INTERVAL '4 minutes', NOW())`
  await sql`
    INSERT INTO trace_events (run_id, request_id, at, step, status, detail, duration_ms) VALUES
      (${runId}, ${requestId}, NOW() - INTERVAL '4 minutes', 'clone', 'ok', 'e2e clone', 1200),
      (${runId}, ${requestId}, NOW() - INTERVAL '2 minutes', 'report', 'ok', 'e2e report headline', 60000)`
  return { requestId, runId }
}

async function cleanup(s: Seeded | null) {
  if (!s || !DB_URL) return
  const sql = neon(DB_URL)
  await sql`DELETE FROM automation_runs WHERE id = ${s.runId}`
  await sql`DELETE FROM agent_requests WHERE id = ${s.requestId}`
}

test.describe('Agents page', () => {
  test('is titled Agents and shows the Agent HQ panel to the owner (or says why not)', async ({ page }) => {
    await page.goto('/agent-performance')
    await expect(page.getByRole('heading', { name: 'Agents', exact: true })).toBeVisible({ timeout: 8000 })
    const panel = page.getByTestId('agent-hq')
    const unavailable = page.getByTestId('agent-hq-unavailable')
    await expect(panel.or(unavailable)).toBeVisible()
    await expect(page.getByText('Open Nexus queue')).toHaveCount(0)
  })

  test('the owner sees Automation (worker/queue) and Requests sections', async ({ page }) => {
    test.skip(!(await getFactoryRepo()), NOT_FACTORY_OWNER)
    await page.goto('/agent-performance')
    await expect(page.getByTestId('automation')).toBeVisible({ timeout: 8000 })
    await expect(page.getByTestId('worker-status')).toBeVisible()
    await expect(page.getByTestId('requests')).toBeVisible()
  })

  test('a reported request shows its findings and step trace', async ({ page }) => {
    test.skip(!(await tablesExist()), 'agent_requests missing — run npm run db:push / npm run factory:migrate')
    const repo = await getFactoryRepo()
    test.skip(!repo, NOT_FACTORY_OWNER)
    let seeded: Seeded | null = null
    try {
      seeded = await seedReportedRequest(repo!)
      await page.goto('/agent-performance')
      const row = page.getByTestId('request-row').filter({ hasText: seeded.requestId })
      await expect(row).toBeVisible({ timeout: 8000 })
      await expect(row.getByText('reported', { exact: true })).toBeVisible()
      await row.getByRole('button', { name: 'Show trace' }).click()
      await expect(row.getByText('src/auth.ts:10 — token logged')).toBeVisible()
      await expect(row.getByTestId('trace-view')).toContainText('e2e report headline', { timeout: 8000 })
      await expect(row.getByTestId('trace-view')).toContainText('Clone')
    } finally {
      await cleanup(seeded)
    }
  })
})

test.describe('Agent HQ API', () => {
  test('overview and trace need a session', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: undefined })
    const page = await ctx.newPage()
    expect((await page.request.get('/api/agent-hq')).status()).toBe(401)
    expect((await page.request.get('/api/agent-hq/trace?runId=x')).status()).toBe(401)
    await ctx.close()
  })

  test('overview is owner-only; trace needs an id', async ({ request }) => {
    const owner = !!(await getFactoryRepo())
    const res = await request.get('/api/agent-hq')
    expect(res.status()).toBe(owner ? 200 : 403)
    if (owner) {
      const body = await res.json() as { redis: string; runs: unknown[]; requests: unknown[] }
      expect(['connected', 'not-configured', 'unreachable']).toContain(body.redis)
      expect(Array.isArray(body.runs) && Array.isArray(body.requests)).toBe(true)
      expect((await request.get('/api/agent-hq/trace')).status()).toBe(400)
      expect((await request.get(`/api/agent-hq/trace?requestId=e2e-${randomUUID()}`)).status()).toBe(404)
    }
  })
})

test.describe('Agent task status API (factory requests)', () => {
  test('401 without a session, 400 without an id, queued for an unknown task', async ({ browser, request }) => {
    const ctx = await browser.newContext({ storageState: undefined })
    expect((await (await ctx.newPage()).request.get('/api/agent-task-status?taskId=x')).status()).toBe(401)
    await ctx.close()
    expect((await request.get('/api/agent-task-status')).status()).toBe(400)
    const unknown = await (await request.get(`/api/agent-task-status?taskId=e2e-${randomUUID()}`)).json() as { status: string; monitorUrl: string }
    expect(unknown.status).toBe('queued')
    expect(unknown.monitorUrl).toBe('/agent-performance')
  })

  test('a reported request maps to report_ready with its findings preview', async ({ request }) => {
    test.skip(!(await tablesExist()), 'agent_requests missing')
    const repo = await getFactoryRepo()
    test.skip(!repo, NOT_FACTORY_OWNER)
    let seeded: Seeded | null = null
    try {
      seeded = await seedReportedRequest(repo!)
      const body = await (await request.get(`/api/agent-task-status?taskId=${seeded.requestId}`)).json() as { status: string }
      expect(body.status).toBe('report_ready')
    } finally {
      await cleanup(seeded)
    }
  })
})

test.describe('Settings — Agent Execution card', () => {
  test('describes the factory, not Nexus', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByText('Agent Execution')).toBeVisible({ timeout: 8000 })
    await expect(page.getByText('FACTORY_USER_ID').first()).toBeVisible()
    await expect(page.getByText('REDIS_URL').first()).toBeVisible()
    await expect(page.getByText('NEXUS_API_URL')).toHaveCount(0)
  })
})
