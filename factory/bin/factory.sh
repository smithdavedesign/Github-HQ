#!/usr/bin/env bash
# launchd entry point for the RepoHQ factory: `factory.sh worker|cycle|scout|report`.
#
# - worker (Phase 81, the default install): the Agent HQ BullMQ worker (factory/worker.ts), kept
#   alive by launchd. It runs requests and the scheduled cycle/report/scout itself, and applies
#   PAUSE, the AC-power rule and caffeinate per job — so none of that wraps the worker here.
# - cycle|scout|report: one run, as the pre-Phase-81 launchd calendar did (still used when no
#   REDIS_URL is configured, and for manual runs).
#
# - launchd has a minimal PATH, so the tool locations are set here.
# - Optional env (FACTORY_DATABASE_URL, FACTORY_USER_ID, FACTORY_MONTHLY_BUDGET_USD, …)
#   is read from ~/.repohq-factory/env. If FACTORY_OP_ENV_FILE is set, secrets are
#   resolved by 1Password at runtime (`op run`) instead — values never touch disk or prompts.
# - caffeinate keeps the Mac awake for the duration of the run only (on AC power).
set -euo pipefail

MODE="${1:-cycle}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOME_DIR="${FACTORY_HOME:-$HOME/.repohq-factory}"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

mkdir -p "$HOME_DIR/logs"
LOG="$HOME_DIR/logs/$MODE-$(date +%Y%m%d-%H%M%S).log"

if [ "$MODE" != worker ] && [ -f "$HOME_DIR/PAUSE" ]; then
  echo "paused — remove $HOME_DIR/PAUSE to resume" >> "$LOG"
  exit 0
fi

# shellcheck disable=SC1091
[ -f "$HOME_DIR/env" ] && set -a && . "$HOME_DIR/env" && set +a

# RepoHQ sink secret comes from the login keychain (stored by install-launchd.sh).
if [ -n "${FACTORY_USER_ID:-}" ] && [ -z "${FACTORY_DATABASE_URL:-}" ]; then
  FACTORY_DATABASE_URL="$(security find-generic-password -s repohq-factory-database-url -w 2>/dev/null || true)"
  [ -n "$FACTORY_DATABASE_URL" ] && export FACTORY_DATABASE_URL
fi
# Agent HQ queue (Phase 81): the Redis URL, also from the keychain.
if [ -z "${REDIS_URL:-}" ]; then
  REDIS_URL="$(security find-generic-password -s repohq-factory-redis-url -w 2>/dev/null || true)"
  [ -n "$REDIS_URL" ] && export REDIS_URL
fi

# Night Shift v2 (Phase 80): on battery, macOS Deep-Idle-sleeps mid-cycle (a 10-minute cycle took
# three hours and lost its push), so scheduled cycles only run on AC power. FACTORY_REQUIRE_AC=0 to override.
if [ "$MODE" = cycle ] && [ "${FACTORY_REQUIRE_AC:-1}" != 0 ] && pmset -g batt 2>/dev/null | grep -q "Battery Power"; then
  echo "=== cycle $(date -u +%FT%TZ): skipped — on battery power (plug in for the night shift) ===" >> "$LOG"
  exit 0
fi

case "$MODE" in
  worker) CMD=(npx --no-install tsx factory/worker.ts) ;;
  cycle) CMD=(npx --no-install tsx factory/run.ts --scheduled) ;;
  scout) CMD=(npx --no-install tsx factory/scout.ts) ;;
  report) CMD=(npx --no-install tsx factory/report.ts) ;;
  *) echo "usage: factory.sh worker|cycle|scout|report" >&2; exit 2 ;;
esac

cd "$ROOT"
if [ -n "${FACTORY_OP_ENV_FILE:-}" ] && command -v op >/dev/null 2>&1; then
  CMD=(op run --env-file="$FACTORY_OP_ENV_FILE" -- "${CMD[@]}")
fi

if [ "$MODE" = worker ]; then
  # Long-running: launchd restarts it (KeepAlive). Each job's child process has its own log and
  # its own caffeinate; keeping the Mac awake for the worker's whole life would never let it sleep.
  echo "=== worker $(date -u +%FT%TZ) ===" >> "$LOG"
  exec "${CMD[@]}" >> "$LOG" 2>&1
fi

{
  echo "=== $MODE $(date -u +%FT%TZ) ==="
  status=0
  # -i idle sleep, -m disk sleep, -s system sleep (only honoured on AC power — on battery,
  # macOS still forces sleep; see factory/README.md "Overnight runs").
  caffeinate -ims "${CMD[@]}" || status=$?
  echo "=== exit $status ==="
} >> "$LOG" 2>&1
