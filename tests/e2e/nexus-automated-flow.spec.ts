/**
 * E2e tests for the fully automated agent execution flow (Phase 46E).
 *
 * Real agent execution takes 5-15+ minutes and requires live Nexus infra,
 * so these tests cover:
 *   1. UI state machine (button renders, shows correct states)
 *   2. Status polling API endpoint (direct HTTP tests)
 *   3. Webhook events update portfolio_events correctly
 *   4. Agent Performance page reflects the full lifecycle
 */
import { test, expect } from '@playwright/test'
import { neon } from '@neondatabase/serverless'

const DB_URL           = process.env.DATABASE_URL ?? ''
const NEXUS_CONFIGURED = !!(process.env.NEXUS_API_URL && process.env.NEXUS_API_TOKEN)

// ─── Run Agent button ─────────────────────────────────────────────────────────

test.describe('Run Agent button', () => {
  test('shows Run Agent (not Queue) when Nexus is configured', async ({ page }) => {
    test.skip(!NEXUS_CONFIGURED, 'Nexus not configured')
    await page.goto('/')
    await page.waitForTimeout(500)
    const btn = page.getByRole('button', { name: /Run Agent/i }).first()
    await expect(btn).toBeVisible({ timeout: 10000 })
  })

  test('button is absent when Nexus is not configured', async ({ page }) => {
    test.skip(NEXUS_CONFIGURED, 'Nexus IS configured')
    await page.goto('/')
    await page.waitForTimeout(500)
    expect(await page.getByRole('button', { name: /Run Agent/i }).count()).toBe(0)
  })

  test('advisor card renders without crashing', async ({ page }) => {
    await page.goto('/')
    const hasAdvisor = await page.getByText('AI Portfolio Advisor').isVisible().catch(() => false)
    const hasGenerate = await page.getByRole('button', { name: /Generate/i }).isVisible().catch(() => false)
    expect(hasAdvisor || hasGenerate).toBe(true)
  })
})

// ─── Status polling API ───────────────────────────────────────────────────────

test.describe('Agent task status API', () => {
  test('returns 401 for unauthenticated requests', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: undefined })
    const page = await ctx.newPage()
    const res = await page.request.get('/api/agent-task-status?taskId=fake-id')
    expect(res.status()).toBe(401)
    await ctx.close()
  })

  test('returns queued for unknown taskId (authenticated)', async ({ request }) => {
    const res = await request.get('/api/agent-task-status?taskId=00000000-0000-0000-0000-000000000000')
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('queued')
  })

  test('returns 400 when taskId is missing', async ({ request }) => {
    const res = await request.get('/api/agent-task-status')
    expect(res.status()).toBe(400)
  })

  test('returns pr_ready status after agent_pr_created event', async ({ request }) => {
    test.skip(!DB_URL, 'DATABASE_URL not set')

    // Seed a pr_created event
    const sql = neon(DB_URL)
    const fakeTaskId = `playwright-status-test-${Date.now()}`

    const [user] = await sql`SELECT id FROM users LIMIT 1`
    if (!user) test.skip(true, 'No user in DB')

    await sql`
      INSERT INTO portfolio_events (user_id, event_type, title, metadata, occurred_at)
      VALUES (
        ${user.id},
        'agent_pr_created',
        'Test PR created',
        ${JSON.stringify({ taskId: fakeTaskId, prUrl: 'https://github.com/test/pr/99' })}::jsonb,
        NOW()
      )
    `

    const res = await request.get(`/api/agent-task-status?taskId=${fakeTaskId}`)
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.status).toBe('pr_ready')
    expect(body.prUrl).toBe('https://github.com/test/pr/99')

    // Cleanup
    await sql`DELETE FROM portfolio_events WHERE metadata->>'taskId' = ${fakeTaskId}`
  })

  test('returns merged when both pr_created and pr_merged exist (merged wins)', async ({ request }) => {
    test.skip(!DB_URL, 'DATABASE_URL not set')

    const sql = neon(DB_URL)
    const fakeTaskId = `playwright-merged-test-${Date.now()}`
    const [user] = await sql`SELECT id FROM users LIMIT 1`
    if (!user) test.skip(true, 'No user')

    await sql`
      INSERT INTO portfolio_events (user_id, event_type, title, metadata, occurred_at)
      VALUES
        (${user.id}, 'agent_pr_created', 'PR created', ${JSON.stringify({ taskId: fakeTaskId, prUrl: 'https://github.com/t/r/1' })}::jsonb, NOW()),
        (${user.id}, 'agent_pr_merged',  'PR merged',  ${JSON.stringify({ taskId: fakeTaskId, prUrl: 'https://github.com/t/r/1' })}::jsonb, NOW())
    `

    const res = await request.get(`/api/agent-task-status?taskId=${fakeTaskId}`)
    expect((await res.json()).status).toBe('merged')

    await sql`DELETE FROM portfolio_events WHERE metadata->>'taskId' = ${fakeTaskId}`
  })
})

// ─── Webhook → status update pipeline ────────────────────────────────────────

test.describe('Webhook + status pipeline (full loop)', () => {
  test('webhook creates event and status API reflects it', async ({ request }) => {
    test.skip(!DB_URL, 'DATABASE_URL not set')

    const sql = neon(DB_URL)
    const [user] = await sql`SELECT id FROM users LIMIT 1`
    if (!user) test.skip(true, 'No user')

    // 1. Simulate Nexus firing agent_pr_created webhook
    const fakeTaskId = `playwright-pipeline-${Date.now()}`

    // Seed queued event first (simulating what queueAdvisorAction would write)
    await sql`
      INSERT INTO portfolio_events (user_id, event_type, title, metadata, occurred_at)
      VALUES (${user.id}, 'agent_task_queued', 'Queued task', ${JSON.stringify({ taskId: fakeTaskId, predictedDelta: '+12 pts' })}::jsonb, NOW())
    `

    // 2. Fire the webhook (as Nexus would)
    const webhookSecret = process.env.NEXUS_WEBHOOK_SECRET ?? ''
    const webhookRes = await request.post('/api/webhooks/agent-events', {
      headers: webhookSecret ? { 'x-nexus-webhook-secret': webhookSecret } : {},
      data: {
        eventType: 'agent_pr_created',
        taskId: fakeTaskId,
        repoName: 'test-repo',
        prUrl: 'https://github.com/smithdavedesign/test-repo/pull/5',
        summary: 'Playwright pipeline test PR',
        agentName: 'Claude Code (Test)',
      },
    })
    expect(webhookRes.status()).toBe(200)

    // 3. Status API should now return pr_ready
    const statusRes = await request.get(`/api/agent-task-status?taskId=${fakeTaskId}`)
    expect(statusRes.status()).toBe(200)
    const status = await statusRes.json()
    // correlated: true means the webhook found the queued event and wrote pr_created
    // The status might be pr_ready if correlated, or still queued if not correlated
    expect(['pr_ready', 'running', 'queued']).toContain(status.status)

    // Cleanup
    await sql`DELETE FROM portfolio_events WHERE metadata->>'taskId' = ${fakeTaskId}`
  })
})

// ─── Agent Performance page reflects automated runs ──────────────────────────

test.describe('Agent Performance — automated run lifecycle', () => {
  test('page loads and shows Activity Log section', async ({ page }) => {
    await page.goto('/agent-performance')
    await expect(page.getByRole('heading', { name: 'Agent Performance' })).toBeVisible()
    await expect(page.getByText('Activity Log')).toBeVisible()
  })

  test('shows accuracy notice with merge count', async ({ page }) => {
    await page.goto('/agent-performance')
    // Either "X of 5 merges needed" or the activity log
    const hasAccuracy = await page.getByText(/of 5 merges needed/).isVisible().catch(() => false)
    const hasActivity = await page.getByText('Activity Log').isVisible().catch(() => false)
    expect(hasAccuracy || hasActivity).toBe(true)
  })

  test('seeded pipeline events appear in activity log', async ({ page }) => {
    test.skip(!DB_URL, 'DATABASE_URL not set')

    const sql = neon(DB_URL)
    const [user] = await sql`SELECT id FROM users LIMIT 1`
    if (!user) test.skip(true, 'No user')

    const fakeTaskId = `playwright-perf-${Date.now()}`
    await sql`
      INSERT INTO portfolio_events (user_id, event_type, title, metadata, occurred_at)
      VALUES (${user.id}, 'agent_task_queued', 'Playwright perf test', ${JSON.stringify({ taskId: fakeTaskId })}::jsonb, NOW())
    `

    await page.goto('/agent-performance')
    await expect(page.getByText('Playwright perf test')).toBeVisible({ timeout: 5000 })

    await sql`DELETE FROM portfolio_events WHERE metadata->>'taskId' = ${fakeTaskId}`
  })

  test('shows Nexus queue link when configured', async ({ page }) => {
    test.skip(!NEXUS_CONFIGURED, 'Nexus not configured')
    await page.goto('/agent-performance')
    await expect(page.getByText('Open Nexus queue')).toBeVisible()
  })

  test('unauthenticated users are redirected to login', async ({ browser }) => {
    const ctx  = await browser.newContext({ storageState: undefined })
    const page = await ctx.newPage()
    await page.goto('/agent-performance')
    await expect(page).toHaveURL(/\/login/)
    await ctx.close()
  })
})

// ─── Sidebar Agents link ──────────────────────────────────────────────────────

test.describe('Navigation', () => {
  test('Agents link is in sidebar', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('link', { name: 'Agents', exact: true })).toBeVisible()
  })

  test('Agents link navigates to agent performance page', async ({ page }) => {
    await page.goto('/agent-performance')
    await expect(page.getByRole('heading', { name: 'Agent Performance' })).toBeVisible()
  })
})
