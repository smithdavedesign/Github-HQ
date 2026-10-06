/**
 * Phase 76 — Sandboxed factory worker, as surfaced on /agent-performance.
 *
 * Covers:
 * - The factory section shows where the latest attempt ran its repo code (Docker sandbox or host)
 * - The sandboxed-attempt count reflects agent_attempt metadata.isolation
 * - Older attempts without isolation metadata count as host runs
 *
 * Seeds `agent_attempt` events (metadata.source = 'factory', as factory/lib/sink.ts writes them)
 * for the signed-in test user, timestamped in the future so they are the "latest run", and removes
 * them afterwards.
 */
import { test, expect } from '@playwright/test'
import { neon } from '@neondatabase/serverless'

const DB_URL = process.env.DATABASE_URL ?? ''
const PREFIX = `phase76-sandbox-${Date.now()}`

async function userId(): Promise<string | null> {
  const sql = neon(DB_URL)
  const [user] = await sql`SELECT id FROM users LIMIT 1`
  return (user?.id as string | undefined) ?? null
}

async function seedAttempt(uid: string, n: number, minutesAhead: number, isolation: 'docker' | 'host' | null) {
  const sql = neon(DB_URL)
  const metadata = {
    source: 'factory', tier: 'M0', model: 'local-agent', harness: 'aider', kind: 'fix-types',
    outcome: 'success', costUsd: 0, ...(isolation ? { isolation } : {}),
  }
  await sql`
    INSERT INTO portfolio_events (user_id, repo_id, event_type, title, metadata, occurred_at)
    VALUES (${uid}, NULL, 'agent_attempt', ${`${PREFIX} attempt ${n}`}, ${JSON.stringify(metadata)}::jsonb,
            NOW() + make_interval(mins => ${minutesAhead}))
  `
}

async function cleanup() {
  if (!DB_URL) return
  const sql = neon(DB_URL)
  await sql`DELETE FROM portfolio_events WHERE title LIKE ${PREFIX + '%'}`
}

async function counts(text: string): Promise<{ sandboxed: number; total: number }> {
  const m = /(\d+) of (\d+) attempts ran repo code in the sandbox/.exec(text)
  if (!m) throw new Error(`isolation line not found in: ${text}`)
  return { sandboxed: Number(m[1]), total: Number(m[2]) }
}

test.describe('Agent Performance — factory sandbox isolation (Phase 76)', () => {
  test.afterEach(cleanup)

  test('latest sandboxed run is shown as Docker, with sandboxed attempts counted', async ({ page }) => {
    test.skip(!DB_URL, 'DATABASE_URL not set')
    const uid = await userId()
    if (!uid) { test.skip(true, 'No user'); return }

    await page.goto('/agent-performance')
    const before = await page.getByTestId('factory-isolation').textContent({ timeout: 8000 }).catch(() => null)
    const base = before ? await counts(before) : { sandboxed: 0, total: 0 }

    await seedAttempt(uid, 1, 60, 'host')
    await seedAttempt(uid, 2, 61, 'docker')
    await seedAttempt(uid, 3, 62, 'docker')

    await page.goto('/agent-performance')
    const line = page.getByTestId('factory-isolation')
    await expect(line).toBeVisible({ timeout: 8000 })
    await expect(line).toContainText('Isolation: latest run sandboxed (Docker)')
    expect(await counts((await line.textContent()) ?? '')).toEqual({ sandboxed: base.sandboxed + 2, total: base.total + 3 })
  })

  test('a newer host run (or one with no isolation metadata) is shown as on the host', async ({ page }) => {
    test.skip(!DB_URL, 'DATABASE_URL not set')
    const uid = await userId()
    if (!uid) { test.skip(true, 'No user'); return }

    await seedAttempt(uid, 1, 60, 'docker')
    await seedAttempt(uid, 2, 61, null)

    await page.goto('/agent-performance')
    const line = page.getByTestId('factory-isolation')
    await expect(line).toBeVisible({ timeout: 8000 })
    await expect(line).toContainText('Isolation: latest run on the host')
  })

  test('the factory tier table still renders alongside the isolation line', async ({ page }) => {
    test.skip(!DB_URL, 'DATABASE_URL not set')
    const uid = await userId()
    if (!uid) { test.skip(true, 'No user'); return }

    await seedAttempt(uid, 1, 60, 'docker')
    await page.goto('/agent-performance')
    await expect(page.getByText('Autonomous Factory by Model Tier')).toBeVisible({ timeout: 8000 })
    await expect(page.getByTestId('factory-isolation')).toBeVisible()
  })
})
