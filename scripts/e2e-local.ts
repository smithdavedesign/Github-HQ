/**
 * The Playwright e2e suite against a fresh local Postgres instead of a Neon branch of production.
 * CI runs it on every PR, so agents merge only after the browser tests pass. Locally:
 *
 *   docker compose --profile flow up -d flow-postgres
 *   npm run test:e2e:local [-- tests/e2e/ideas.spec.ts]
 *
 * No production data and no real secret reach it: the database starts empty apart from one owner
 * (the signed-in e2e user, who owns the factory), the app gets dummy keys, and every provider key is
 * blanked so a developer's .env.local can't fill it in. Specs that need real synced data skip
 * (tests/e2e/helpers/disposable-db.ts LOCAL_DB). Queries reach Postgres through the flow tests'
 * neon-local shim, so the app's Neon HTTP driver runs unmodified.
 */
import { spawnSync } from 'node:child_process'
import { FLOW, closePools, createDatabase, neonUrl, q, shimNodeOptions } from '../tests/flow/harness/flow'

const DB = 'agent_hq_flow_e2e_suite'
const PORT = process.env.E2E_PORT ?? '3100'
const OWNER = 'e2e-owner'

async function main(): Promise<number> {
  await createDatabase(DB)
  // A GitHub avatar like a real account's (the Settings page shows it): GitHub's public Octocat.
  await q(DB, `INSERT INTO users (id, name, email, image, github_login, last_synced_at) VALUES ($1, 'E2E Owner', 'owner@e2e.test', $2, 'e2e-owner', $3)`,
    [OWNER, 'https://avatars.githubusercontent.com/u/583231?v=4', new Date().toISOString()])
  await closePools()

  const base = `http://localhost:${PORT}`
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_OPTIONS: shimNodeOptions(),
    NEON_LOCAL_PG_URL: FLOW.pgServerUrl,
    DATABASE_URL: neonUrl(DB),
    E2E_DISPOSABLE_DB: '1',
    E2E_LOCAL_DB: '1',
    E2E_PORT: PORT,
    FACTORY_USER_ID: OWNER,
    // Never the real factory queue.
    REDIS_URL: '',
    AUTH_SECRET: 'e2e-local-secret-used-nowhere-else-0000',
    AUTH_TRUST_HOST: 'true',
    AUTH_URL: base,
    NEXTAUTH_URL: base,
    NEXT_PUBLIC_APP_URL: base,
    GITHUB_CLIENT_ID: 'e2e-local',
    GITHUB_CLIENT_SECRET: 'e2e-local',
    CRON_SECRET: 'e2e-local',
    ENCRYPTION_KEY: `${'0'.repeat(63)}1`,
    // Defined (empty) so .env.local can't fill them in: no paid or third-party API from a test run.
    ANTHROPIC_API_KEY: '',
    OPENAI_API_KEY: '',
    GEMINI_API_KEY: '',
    OPENROUTER_API_KEY: '',
    STRIPE_API_KEY: '',
    STRIPE_SECRET_KEY: '',
    GITHUB_TOKEN: '',
    GH_TOKEN: '',
    TZ: 'America/Los_Angeles',
  }
  const run = spawnSync('npx', ['playwright', 'test', ...process.argv.slice(2)], { stdio: 'inherit', env })
  return run.status ?? 1
}

main().then(code => process.exit(code), (err) => { console.error(err); process.exit(1) })
