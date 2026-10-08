/**
 * Migration validation (roadmap Phase 81, docs/agent-hq-migration-prd.md §5, §11).
 *
 * Production gets the Phase 81 schema one of two ways: `npm run db:push` (drizzle-kit) or the
 * factory's idempotent `npm run factory:migrate` (factory/sql/0002_agent_hq_queue.sql). Both must
 * land on the same tables, columns, indexes and constraints, and the migration must be safe to run
 * again. The real migrate script runs here as a child process, through the Neon HTTP driver.
 */
import { execFileSync } from 'node:child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FLOW, ROOT, closePools, createDatabase, neonUrl, q, shimNodeOptions } from './harness/flow'

const FRESH = 'agent_hq_flow_schema'
const UPGRADED = 'agent_hq_flow_upgrade'

/** Production before Phase 81: today's schema without the objects 0002 adds. */
const BEFORE_PHASE_81 = `
  DROP TABLE trace_events;
  DROP TABLE automation_runs;
  DROP TABLE agent_requests;
  DROP INDEX agent_jobs_request_idx;
  ALTER TABLE agent_jobs DROP COLUMN request_id;
`

function migrate(database: string): string {
  return execFileSync(process.execPath, ['--import', 'tsx', 'factory/bin/migrate.ts'], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: shimNodeOptions(), NEON_LOCAL_PG_URL: FLOW.pgServerUrl, FACTORY_DATABASE_URL: neonUrl(database) },
  })
}

async function catalog(database: string) {
  const [columns, indexes, constraints] = await Promise.all([
    q(database, `SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
      FROM information_schema.columns WHERE table_schema = 'public' ORDER BY table_name, column_name`),
    q(database, `SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' ORDER BY tablename, indexname`),
    q(database, `SELECT conrelid::regclass::text AS "table", conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint WHERE connamespace = 'public'::regnamespace ORDER BY 1, 2`),
  ])
  return { columns, indexes, constraints }
}

beforeAll(async () => {
  await createDatabase(FRESH)
  await createDatabase(UPGRADED)
  await q(UPGRADED, BEFORE_PHASE_81)
})

afterAll(closePools)

describe('npm run factory:migrate on a pre-Phase-81 database', () => {
  it('starts from a database without the Agent HQ tables', async () => {
    const tables = await q<{ table_name: string }>(UPGRADED, `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`)
    const names = tables.map(t => t.table_name)
    expect(names).toContain('agent_jobs')
    expect(names).not.toContain('agent_requests')
    expect(names).not.toContain('automation_runs')
    expect(names).not.toContain('trace_events')
  })

  it('applies 0001 and 0002 through the Neon HTTP driver', () => {
    const out = migrate(UPGRADED)
    expect(out).toMatch(/applied 0001_agent_jobs\.sql/)
    expect(out).toMatch(/applied 0002_agent_hq_queue\.sql \(\d+ statements\)/)
  })

  it('lands on exactly the schema db:push creates (columns, indexes, constraints)', async () => {
    const [upgraded, fresh] = await Promise.all([catalog(UPGRADED), catalog(FRESH)])
    expect(upgraded.columns).toEqual(fresh.columns)
    expect(upgraded.indexes).toEqual(fresh.indexes)
    expect(upgraded.constraints).toEqual(fresh.constraints)
  })

  it('is idempotent: a second run changes nothing', async () => {
    const before = await catalog(UPGRADED)
    expect(migrate(UPGRADED)).toMatch(/applied 0002_agent_hq_queue\.sql/)
    expect(await catalog(UPGRADED)).toEqual(before)
  })

  it('is a no-op on a database db:push already created', async () => {
    const before = await catalog(FRESH)
    migrate(FRESH)
    expect(await catalog(FRESH)).toEqual(before)
  })
})

describe('Phase 81 data rules (PRD §5)', () => {
  const now = new Date().toISOString()

  beforeAll(async () => {
    await q(FRESH, `INSERT INTO users (id, email) VALUES ('rules-user', 'rules@flow.test')`)
    const [repo] = await q<{ id: number }>(FRESH, `INSERT INTO repositories (user_id, github_id, name, owner, full_name, created_at, updated_at)
      VALUES ('rules-user', 1, 'r', 'o', 'o/r', $1, $1) RETURNING id`, [now])
    await q(FRESH, `INSERT INTO agent_requests (id, user_id, repo_id, repo, mode, objective, source) VALUES ('rules-req', 'rules-user', $1, 'o/r', 'report', 'x', 'ui-skill')`, [repo.id])
    await q(FRESH, `INSERT INTO automation_runs (id, user_id, kind, trigger, request_id, status) VALUES ('rules-run', 'rules-user', 'factory-request', 'request', 'rules-req', 'running')`)
    await q(FRESH, `INSERT INTO trace_events (run_id, request_id, step, status) VALUES ('rules-run', 'rules-req', 'clone', 'ok'), ('rules-run', 'rules-req', 'checks', 'ok')`)
  })

  it('a new request starts queued with no attempts', async () => {
    const [row] = await q<{ status: string; attempts: number; created_at: Date }>(FRESH, `SELECT status, attempts, created_at FROM agent_requests WHERE id = 'rules-req'`)
    expect(row.status).toBe('queued')
    expect(row.attempts).toBe(0)
    // defaultNow() is UTC wall time: within a minute of now, not hours off.
    expect(Math.abs(row.created_at.getTime() - Date.now())).toBeLessThan(60_000)
  })

  it("a run's trace goes with it (90-day pruning deletes runs only)", async () => {
    await q(FRESH, `DELETE FROM automation_runs WHERE id = 'rules-run'`)
    expect(await q(FRESH, `SELECT 1 FROM trace_events WHERE run_id = 'rules-run'`)).toHaveLength(0)
  })

  it('a request outlives its repo (repo_id → null) but not its user', async () => {
    await q(FRESH, `DELETE FROM repositories WHERE user_id = 'rules-user'`)
    const [row] = await q<{ repo_id: number | null; repo: string }>(FRESH, `SELECT repo_id, repo FROM agent_requests WHERE id = 'rules-req'`)
    expect(row).toEqual({ repo_id: null, repo: 'o/r' })
    await q(FRESH, `DELETE FROM users WHERE id = 'rules-user'`)
    expect(await q(FRESH, `SELECT 1 FROM agent_requests WHERE id = 'rules-req'`)).toHaveLength(0)
  })
})
