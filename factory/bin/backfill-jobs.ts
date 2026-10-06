/**
 * Copy the local ledger's attempt history into RepoHQ's `agent_jobs` table (roadmap Phase 79).
 * Idempotent. Needs the sink configured (FACTORY_USER_ID; DB URL from FACTORY_DATABASE_URL or
 * RepoHQ's .env.local), e.g.:  set -a; . ~/.repohq-factory/env; set +a; npm run factory:backfill-jobs
 */
import { loadConfig } from '../lib/config'
import { readLedger, type AttemptEntry, type ResolutionEntry } from '../lib/ledger'
import { backfillJobs } from '../lib/sink'

async function main() {
  const cfg = loadConfig()
  const entries = readLedger(cfg.home)
  const attempts = entries.filter((e): e is AttemptEntry => e.type === 'attempt' && !e.voided)
  const resolutions = new Map(entries.filter((e): e is ResolutionEntry => e.type === 'resolution').map(r => [r.attemptId, r]))
  const n = await backfillJobs(cfg, attempts, resolutions)
  console.log(`agent_jobs: ${n} new row(s) from ${attempts.length} ledger attempt(s)`)
}

main().catch(err => { console.error(err instanceof Error ? err.message : err); process.exit(1) })
