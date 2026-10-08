/**
 * Shared settings for the browser flow suite (playwright.flow.config.ts): the app runs with
 * `next dev` against a disposable local database, never .env.local's.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { FLOW, ROOT, neonUrl, shimNodeOptions } from '../harness/flow'

export const PORT = Number(process.env.FLOW_E2E_PORT ?? 3100)
export const BASE_URL = `http://localhost:${PORT}`
export const E2E_DB = 'agent_hq_flow_e2e'

const AUTH_DIR = path.join(ROOT, 'tests', 'flow', 'e2e', '.auth')
export const OWNER_STATE = path.join(AUTH_DIR, 'owner.json')
export const OTHER_STATE = path.join(AUTH_DIR, 'other.json')
export const SEED_FILE = path.join(AUTH_DIR, 'seeded.json')

/** The app's environment: every variable that reaches a database, a queue or a paid API is set here. */
export function appEnv(): Record<string, string> {
  return {
    NODE_OPTIONS: shimNodeOptions(),
    NEON_LOCAL_PG_URL: FLOW.pgServerUrl,
    DATABASE_URL: neonUrl(E2E_DB),
    REDIS_URL: FLOW.redisUrl,
    FACTORY_USER_ID: FLOW.ownerId,
    AUTH_SECRET: 'flow-e2e-secret-used-nowhere-else-000',
    AUTH_TRUST_HOST: 'true',
    AUTH_URL: BASE_URL,
    NEXTAUTH_URL: BASE_URL,
    NEXT_PUBLIC_APP_URL: BASE_URL,
    GITHUB_CLIENT_ID: 'flow-e2e',
    GITHUB_CLIENT_SECRET: 'flow-e2e',
    CRON_SECRET: 'flow-e2e',
    ENCRYPTION_KEY: `${'0'.repeat(63)}1`,
    // Defined (empty) so a developer's .env.local can't fill them in: no paid API from a test run.
    ANTHROPIC_API_KEY: '',
    OPENAI_API_KEY: '',
    GEMINI_API_KEY: '',
    STRIPE_API_KEY: '',
    STRIPE_SECRET_KEY: '',
    TZ: 'America/Los_Angeles',
  }
}

export interface E2eSeed {
  ownerId: string
  /** Allowlisted repos, one per spec that queues work (one open request per repo). */
  reportRepo: { id: number; name: string }
  prRepo: { id: number; name: string }
  controlsRepo: { id: number; name: string }
  outsideRepo: { id: number; name: string }
  otherRepo: { id: number; name: string }
}

export function seeded(): E2eSeed {
  return JSON.parse(readFileSync(SEED_FILE, 'utf8')) as E2eSeed
}
