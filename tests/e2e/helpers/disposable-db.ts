/**
 * `npm run test:e2e` runs the suite on a throwaway Neon branch (scripts/e2e-branch.sh sets
 * E2E_DISPOSABLE_DB=1). `npm run test:e2e:prod-db` still runs it against .env.local's production
 * DATABASE_URL, where specs that overwrite or delete rows they didn't create are skipped. (In 2026-10 a spec that
 * deleted and re-inserted health history timed out mid-restore and lost months of snapshots.)
 */
export const DISPOSABLE_DB = process.env.E2E_DISPOSABLE_DB === '1'
export const DISPOSABLE_DB_REASON = 'writes shared rows — set E2E_DISPOSABLE_DB=1 with DATABASE_URL on a throwaway Neon branch'
