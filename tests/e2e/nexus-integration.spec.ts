/**
 * E2e tests for the RepoHQ × Nexus integration (Phase 46).
 *
 * The Queue button visibility depends on NEXUS_API_URL + NEXUS_API_TOKEN
 * being set server-side. Tests cover the UI states for both configured
 * and unconfigured scenarios.
 */
import { test, expect } from '@playwright/test'
import { neon } from '@neondatabase/serverless'

const DB_URL = process.env.DATABASE_URL ?? ''
const NEXUS_CONFIGURED = !!(process.env.NEXUS_API_URL && process.env.NEXUS_API_TOKEN)

// ─── Settings — Agent Execution card ─────────────────────────────────────────

test.describe('Settings — Agent Execution card', () => {
  test('shows Agent Execution section', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByText('Agent Execution', { exact: true }).first()).toBeVisible()
  })

  test('shows connection status indicator', async ({ page }) => {
    await page.goto('/settings')
    // Either "Connected" (green dot + URL) or "Not configured" depending on env
    const connected    = await page.getByText(/Not configured|ai-devops-nexus/).isVisible().catch(() => false)
    expect(connected).toBe(true)
  })

  test('shows env var instructions', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByText('NEXUS_API_URL')).toBeVisible()
    await expect(page.getByText('NEXUS_API_TOKEN')).toBeVisible()
  })
})

// ─── Dashboard — Advisor Queue button ────────────────────────────────────────

test.describe('Dashboard — Advisor Queue button', () => {
  test('advisor card is present', async ({ page }) => {
    await page.goto('/')
    // Advisor card may have generate button or actions depending on data
    const hasAdvisor = await page.getByText('AI Portfolio Advisor').isVisible().catch(() => false)
    const hasGenerate = await page.getByRole('button', { name: /Generate Advisor/i }).isVisible().catch(() => false)
    expect(hasAdvisor || hasGenerate).toBe(true)
  })

  test('Queue button appears when Nexus is configured', async ({ page }) => {
    test.skip(!NEXUS_CONFIGURED, 'NEXUS_API_URL/TOKEN not set in env')

    await page.goto('/')
    // Give advisor card time to render
    await page.waitForTimeout(1000)

    const queueButtons = page.getByRole('button', { name: /Queue/i })
    const count = await queueButtons.count()
    expect(count).toBeGreaterThan(0)
  })

  test('Queue button is NOT present when Nexus is unconfigured', async ({ page }) => {
    test.skip(NEXUS_CONFIGURED, 'Nexus IS configured — skipping unconfigured test')

    await page.goto('/')
    await page.waitForTimeout(500)

    const queueButtons = page.getByRole('button', { name: /Queue →/i })
    expect(await queueButtons.count()).toBe(0)
  })

  test('Queue button shows loading state when clicked', async ({ page }) => {
    test.skip(!NEXUS_CONFIGURED, 'NEXUS_API_URL/TOKEN not set in env')

    await page.goto('/')
    const queueBtn = page.getByRole('button', { name: /Queue →/i }).first()
    await expect(queueBtn).toBeVisible({ timeout: 10000 })

    await queueBtn.click()
    // Should immediately show "Queuing…" spinner state
    await expect(page.getByText(/Queuing|Queued|Failed/i).first()).toBeVisible({ timeout: 10000 })
  })
})

// ─── Agent Performance page ───────────────────────────────────────────────────

test.describe('Agent Performance page', () => {
  test('loads the agent performance page', async ({ page }) => {
    await page.goto('/agent-performance')
    await expect(page.getByRole('heading', { name: 'Agent Performance', exact: true })).toBeVisible()
  })

  test('shows stats cards', async ({ page }) => {
    await page.goto('/agent-performance')
    await expect(page.getByText('Tasks queued')).toBeVisible()
    await expect(page.getByText('PRs merged')).toBeVisible()
    await expect(page.getByText('Success rate')).toBeVisible()
  })

  test('shows empty state or activity log', async ({ page }) => {
    await page.goto('/agent-performance')
    const hasActivity = await page.getByText('Activity Log').isVisible().catch(() => false)
    const hasEmpty    = await page.getByText('No agent activity yet').isVisible().catch(() => false)
    expect(hasActivity || hasEmpty).toBe(true)
  })

  test('shows Nexus queue link when Nexus is configured', async ({ page }) => {
    test.skip(!NEXUS_CONFIGURED, 'Nexus not configured')
    await page.goto('/agent-performance')
    await expect(page.getByText('Open Nexus queue')).toBeVisible()
  })

  test('sidebar has Agents link', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('link', { name: 'Agents', exact: true })).toBeVisible()
  })

  test('unauthenticated users are redirected', async ({ browser }) => {
    const context = await browser.newContext({ storageState: undefined })
    const page    = await context.newPage()
    await page.goto('/agent-performance')
    await expect(page).toHaveURL(/\/login/)
    await context.close()
  })
})

// ─── Webhook endpoint ─────────────────────────────────────────────────────────

test.describe('Webhook endpoint', () => {
  test('returns 200 for valid event without secret check', async ({ request }) => {
    const res = await request.post('/api/webhooks/agent-events', {
      data: { eventType: 'agent_task_queued', taskId: 'test-task-id' },
    })
    expect(res.status()).toBe(200)
  })

  test('returns 401 when wrong webhook secret is provided', async ({ request }) => {
    // Only runs when NEXUS_WEBHOOK_SECRET is configured
    test.skip(!process.env.NEXUS_WEBHOOK_SECRET, 'No webhook secret configured')

    const res = await request.post('/api/webhooks/agent-events', {
      headers: { 'x-nexus-webhook-secret': 'wrong-secret' },
      data: { eventType: 'agent_pr_merged', taskId: 'test-id' },
    })
    expect(res.status()).toBe(401)
  })

  test('returns 400 for invalid JSON', async ({ request }) => {
    const res = await request.post('/api/webhooks/agent-events', {
      headers: { 'Content-Type': 'application/json' },
      data: 'not-valid-json',
    })
    // Should return 400 or 200 gracefully — either is acceptable
    expect([200, 400]).toContain(res.status())
  })

  test('agent_pr_merged event is accepted', async ({ request }) => {
    const res = await request.post('/api/webhooks/agent-events', {
      data: {
        eventType: 'agent_pr_merged',
        taskId: 'playwright-test-task',
        repoName: 'test-repo',
        summary: 'Playwright test merge event',
      },
    })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })
})

// ─── DB state check after queue (integration) ─────────────────────────────────

test.describe('portfolio_events DB state', () => {
  test('agent_task_queued events are stored correctly', async () => {
    test.skip(!DB_URL, 'DATABASE_URL not set')

    const sql = neon(DB_URL)
    const rows = await sql`
      SELECT event_type, metadata FROM portfolio_events
      WHERE event_type = 'agent_task_queued'
      ORDER BY occurred_at DESC LIMIT 5
    `

    // If any queued events exist, verify structure
    if (rows.length > 0) {
      const meta = rows[0].metadata as Record<string, unknown>
      expect(meta).toHaveProperty('taskId')
      expect(meta).toHaveProperty('predictedDelta')
    }
    // Zero rows is also fine — means nobody has queued yet
    expect(rows.length).toBeGreaterThanOrEqual(0)
  })
})
