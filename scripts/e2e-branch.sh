#!/usr/bin/env bash
# Run the Playwright e2e suite against a throwaway Neon branch of production, never production
# itself (2026-10-06: a spec timed out mid-restore and lost months of health history).
#
#   npm run test:e2e                      # whole suite
#   npm run test:e2e -- tests/e2e/x.spec.ts
#
# The branch is a copy-on-write copy of `main` made for this run and deleted when it ends, so
# specs that overwrite or delete shared rows run too (E2E_DISPOSABLE_DB=1). The app runs on its
# own port so an already-running `npm run dev` (on production) is never reused. Needs the Neon
# CLI, logged in (`neon auth`).
set -euo pipefail

PROJECT="${NEON_PROJECT_ID:-noisy-haze-22150301}"
BRANCH="e2e-$(date +%Y%m%d-%H%M%S)-$$"
PORT="${E2E_PORT:-3100}"

echo "[e2e] creating Neon branch $BRANCH from main"
neon branches create --project-id "$PROJECT" --name "$BRANCH" --parent main --output json >/dev/null
cleanup() {
  if neon branches delete "$BRANCH" --project-id "$PROJECT" >/dev/null 2>&1; then
    echo "[e2e] deleted branch $BRANCH"
  else
    echo "[e2e] WARNING: could not delete Neon branch $BRANCH — delete it by hand (neon branches delete $BRANCH)"
  fi
}
trap cleanup EXIT

DATABASE_URL="$(neon connection-string "$BRANCH" --project-id "$PROJECT")"
export DATABASE_URL
export E2E_DISPOSABLE_DB=1
export E2E_PORT="$PORT"
export NEXTAUTH_URL="http://localhost:$PORT" AUTH_URL="http://localhost:$PORT" NEXT_PUBLIC_APP_URL="http://localhost:$PORT"
# Never reach the real factory queue from a test run.
export REDIS_URL=""
# The signed-in e2e user (auth.setup.ts: the most recently synced) owns the factory on the
# branch, so the owner-only specs (skill launcher, Agent HQ) run instead of skipping. Safe: with
# REDIS_URL empty, queued requests stay rows in the throwaway branch.
FACTORY_USER_ID="$(node --input-type=module -e "import { neon } from '@neondatabase/serverless'; const [u] = await neon(process.env.DATABASE_URL)\`select id from users order by last_synced_at desc nulls last limit 1\`; console.log(u?.id ?? '')")"
export FACTORY_USER_ID

echo "[e2e] app on :$PORT against the branch"
npx playwright test "$@"
