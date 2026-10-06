/**
 * The e2e suite runs against whatever DATABASE_URL .env.local holds, which is the production
 * database. Specs that overwrite or delete rows they didn't create run only when you point
 * DATABASE_URL at a throwaway Neon branch and set E2E_DISPOSABLE_DB=1. (In 2026-10 a spec that
 * deleted and re-inserted health history timed out mid-restore and lost months of snapshots.)
 */
export const DISPOSABLE_DB = process.env.E2E_DISPOSABLE_DB === '1'
export const DISPOSABLE_DB_REASON = 'writes shared rows — set E2E_DISPOSABLE_DB=1 with DATABASE_URL on a throwaway Neon branch'
