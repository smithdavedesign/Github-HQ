/**
 * `npm run test:e2e` runs the suite on a throwaway Neon branch (scripts/e2e-branch.sh sets
 * E2E_DISPOSABLE_DB=1). `npm run test:e2e:prod-db` still runs it against .env.local's production
 * DATABASE_URL, where specs that overwrite or delete rows they didn't create are skipped. (In 2026-10 a spec that
 * deleted and re-inserted health history timed out mid-restore and lost months of snapshots.)
 */
export const DISPOSABLE_DB = process.env.E2E_DISPOSABLE_DB === '1'
export const DISPOSABLE_DB_REASON = 'writes shared rows — set E2E_DISPOSABLE_DB=1 with DATABASE_URL on a throwaway Neon branch'

/**
 * `npm run test:e2e:local`, and CI, run the suite on a fresh local Postgres that holds one owner and no
 * synced data (scripts/e2e-local.ts sets E2E_LOCAL_DB=1). Specs that need real repos, PRs or history skip
 * there and still run on a Neon branch.
 */
export const LOCAL_DB = process.env.E2E_LOCAL_DB === '1'
export const LOCAL_DB_REASON = 'needs synced data (repos, PRs, history): runs on a Neon branch (npm run test:e2e), not the empty CI database'
