#!/usr/bin/env bash
# launchd entry point for the RepoHQ factory: `factory.sh cycle` or `factory.sh scout`.
#
# - launchd has a minimal PATH, so the tool locations are set here.
# - Optional env (FACTORY_DATABASE_URL, FACTORY_USER_ID, FACTORY_MONTHLY_BUDGET_USD, …)
#   is read from ~/.repohq-factory/env. If FACTORY_OP_ENV_FILE is set, secrets are
#   resolved by 1Password at runtime (`op run`) instead — values never touch disk or prompts.
# - caffeinate keeps the Mac awake for the duration of the run only.
set -euo pipefail

MODE="${1:-cycle}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOME_DIR="${FACTORY_HOME:-$HOME/.repohq-factory}"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

mkdir -p "$HOME_DIR/logs"
LOG="$HOME_DIR/logs/$MODE-$(date +%Y%m%d-%H%M%S).log"

if [ -f "$HOME_DIR/PAUSE" ]; then
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

case "$MODE" in
  cycle) CMD=(npx --no-install tsx factory/run.ts) ;;
  scout) CMD=(npx --no-install tsx factory/scout.ts) ;;
  *) echo "usage: factory.sh cycle|scout" >&2; exit 2 ;;
esac

cd "$ROOT"
if [ -n "${FACTORY_OP_ENV_FILE:-}" ] && command -v op >/dev/null 2>&1; then
  CMD=(op run --env-file="$FACTORY_OP_ENV_FILE" -- "${CMD[@]}")
fi

{
  echo "=== $MODE $(date -u +%FT%TZ) ==="
  status=0
  caffeinate -i "${CMD[@]}" || status=$?
  echo "=== exit $status ==="
} >> "$LOG" 2>&1
