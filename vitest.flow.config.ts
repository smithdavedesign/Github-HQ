import { defineConfig } from 'vitest/config'
import path from 'path'

/**
 * Flow tests (roadmap Phase 81): the Agent HQ queue end to end against a local Postgres and
 * Redis — the app enqueues, the real worker runs jobs, Neon rows, events, traces and the status
 * API reflect it. Needs `docker compose --profile flow up -d` (or FLOW_DATABASE_URL /
 * FLOW_REDIS_URL); see tests/flow/harness/flow.ts. `npm run test:flow`.
 */
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/flow/**/*.flow.test.ts'],
    setupFiles: ['tests/flow/harness/setup.ts'],
    // One Redis queue and one worker at a time: files run one after another.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 180_000,
    // Not UTC on purpose: timestamps are stored as zone-less UTC, and the factory runs on a Mac in
    // a real time zone. A local-time parse anywhere on the path shows up as an hours-off assertion.
    env: { TZ: 'America/Los_Angeles' },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      'server-only': path.resolve(__dirname, './node_modules/server-only/empty.js'),
    },
  },
})
