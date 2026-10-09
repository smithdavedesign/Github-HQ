import { defineConfig, devices } from '@playwright/test'
import { config } from 'dotenv'

// Values already in the environment win (scripts/e2e-branch.sh sets DATABASE_URL to a throwaway
// Neon branch); .env.local fills in the rest.
config({ path: '.env.local' })

const PORT = Number(process.env.E2E_PORT ?? 3000)
const BRANCH_RUN = process.env.E2E_DISPOSABLE_DB === '1'

const AUTH_STATE = 'tests/setup/auth-state.json'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  retries: 0,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'setup',
      testDir: './tests/setup',
      testMatch: 'auth.setup.ts',
      // No storageState — this project creates the file
      teardown: 'teardown',
    },
    {
      name: 'teardown',
      testDir: './tests/setup',
      testMatch: 'auth.teardown.ts',
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: AUTH_STATE,
      },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    command: `npm run dev -- --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    // A branch run always starts its own server: a reused one could be talking to production.
    reuseExistingServer: !process.env.CI && !BRANCH_RUN,
    timeout: 60000,
  },
})
