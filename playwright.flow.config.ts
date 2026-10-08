import { defineConfig, devices } from '@playwright/test'
import { BASE_URL, OWNER_STATE, PORT, appEnv } from './tests/flow/e2e/env'

/**
 * Browser flow suite (roadmap Phase 81): the Agent HQ flow in the real UI. `next dev` runs against
 * a disposable local Postgres (through tests/flow/harness/neon-local.cjs) and a local Redis, and
 * the real factory worker runs the scripted stand-in job. Nothing here reads .env.local's
 * database — unlike playwright.config.ts, which runs against production.
 *
 *   docker compose --profile flow up -d && npm run test:flow:e2e
 *
 * FLOW_CHROMIUM points at a Chromium binary when the one matching @playwright/test isn't installed.
 */
export default defineConfig({
  testDir: './tests/flow/e2e',
  testMatch: '*.spec.ts',
  globalSetup: './tests/flow/e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // The first visit to each page compiles it (next dev).
  timeout: 180_000,
  expect: { timeout: 30_000 },
  reporter: 'list',
  use: {
    baseURL: BASE_URL,
    storageState: OWNER_STATE,
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
    navigationTimeout: 120_000,
    ...(process.env.FLOW_CHROMIUM ? { launchOptions: { executablePath: process.env.FLOW_CHROMIUM } } : {}),
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx next dev -p ${PORT}`,
    url: `${BASE_URL}/login`,
    env: appEnv(),
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: process.env.FLOW_DEBUG ? 'pipe' : 'ignore',
    stderr: 'pipe',
  },
})
