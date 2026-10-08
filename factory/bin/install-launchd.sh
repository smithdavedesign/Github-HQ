#!/usr/bin/env bash
# Deploy the factory to ~/.repohq-factory/app and install (or remove with --uninstall) its launchd jobs.
# Re-run after committing factory changes to redeploy.
#
# With a REDIS_URL (Agent HQ, roadmap Phase 81 — env, keychain, or REDIS_URL in .env.local):
#   com.repohq.factory.worker — the BullMQ worker (factory/worker.ts), always on (KeepAlive). It runs
#                               Agent HQ requests and the scheduled cycle / report / scout, whose
#                               times are now BullMQ job schedulers (factory.config.json `schedules`).
# Without one, the pre-Phase-81 calendar (no Agent HQ requests):
#   com.repohq.factory.cycle  — hourly 20:00–06:00 (Night Shift v2) plus 12:00 and 16:00 local (≤ 1 PR per cycle,
#                               ≤ maxPrsPerDay per factory day) → 3–8 draft PRs by morning
#   com.repohq.factory.report — 06:45 local: one update per gstack role, emailed
#   com.repohq.factory.scout  — Sundays 17:10 local
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENTS="$HOME/Library/LaunchAgents"
DOMAIN="gui/$(id -u)"
# launchd jobs can't read ~/Documents (macOS privacy/TCC), and the factory shouldn't run
# from the owner's working copy anyway: deploy the committed HEAD to its own checkout.
APP="${FACTORY_HOME:-$HOME/.repohq-factory}/app"

plist() { # label mode calendar-xml
  cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$1</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$APP/factory/bin/factory.sh</string><string>$2</string></array>
  <key>StartCalendarInterval</key>
  $3
  <key>StandardOutPath</key><string>$HOME/.repohq-factory/logs/launchd-$2.out</string>
  <key>StandardErrorPath</key><string>$HOME/.repohq-factory/logs/launchd-$2.err</string>
  <!-- Standard, not Background: Background/LowPriorityIO throttling made npm ci take 4.5 min and
       timing-sensitive test suites fail, which the factory would then try to "fix". -->
  <key>ProcessType</key><string>Standard</string>
  <key>Nice</key><integer>5</integer>
</dict>
</plist>
PLIST
}

# Always-on job for the Agent HQ worker. ThrottleInterval keeps a misconfigured worker from
# restart-looping faster than once a minute.
worker_plist() {
  cat <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.repohq.factory.worker</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$APP/factory/bin/factory.sh</string><string>worker</string></array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>60</integer>
  <key>StandardOutPath</key><string>$HOME/.repohq-factory/logs/launchd-worker.out</string>
  <key>StandardErrorPath</key><string>$HOME/.repohq-factory/logs/launchd-worker.err</string>
  <key>ProcessType</key><string>Standard</string>
  <key>Nice</key><integer>5</integer>
</dict>
</plist>
PLIST
}

CALENDAR_LABELS="com.repohq.factory.cycle com.repohq.factory.report com.repohq.factory.scout"
LABELS="$CALENDAR_LABELS com.repohq.factory.worker"
for label in $LABELS; do
  launchctl bootout "$DOMAIN/$label" 2>/dev/null || true
  rm -f "$AGENTS/$label.plist"
done
if [ "${1:-}" = "--uninstall" ]; then
  echo "factory launchd jobs removed"
  exit 0
fi

mkdir -p "$AGENTS" "$HOME/.repohq-factory/logs"

# ── Deploy: pinned checkout of this repo's committed HEAD ────────────────────
SHA="$(git -C "$ROOT" rev-parse HEAD)"
[ -n "$(git -C "$ROOT" status --porcelain -- factory src/lib/agents)" ] && echo "warning: uncommitted factory changes are NOT deployed (deploying $SHA)"
if [ ! -d "$APP/.git" ]; then
  git clone -q "$ROOT" "$APP"
fi
git -C "$APP" fetch -q origin "$SHA" 2>/dev/null || git -C "$APP" fetch -q origin
git -C "$APP" checkout -q --detach "$SHA"
(cd "$APP" && npm ci --no-audit --no-fund --silent >/dev/null)
echo "deployed $(git -C "$APP" log -1 --format='%h %s') → $APP"

# ── Sandbox images (Phase 76): build now so the first scheduled cycle doesn't spend minutes on it ─
if docker info >/dev/null 2>&1; then
  (cd "$APP" && npx --no-install tsx factory/bin/build-sandbox.ts) || echo "warning: sandbox image build failed — cycles will retry it, and skip until Docker can build"
else
  echo "warning: Docker is not running — scheduled cycles are skipped until it is (repo code never runs on the host)"
fi

# ── Secret for the optional RepoHQ sink: macOS keychain, not a plaintext file ─
if [ -f "$ROOT/.env.local" ] && ! security find-generic-password -s repohq-factory-database-url >/dev/null 2>&1; then
  DB_URL="$(sed -nE 's/^DATABASE_URL=["'"'"']?([^"'"'"']+)["'"'"']?$/\1/p' "$ROOT/.env.local" | head -1)"
  if [ -n "$DB_URL" ]; then
    security add-generic-password -U -s repohq-factory-database-url -a "$USER" -w "$DB_URL"
    echo "stored RepoHQ DATABASE_URL in the login keychain (service repohq-factory-database-url)"
  fi
  unset DB_URL
fi
# ── Agent HQ queue (Phase 81): REDIS_URL → keychain, then the worker replaces the calendar ─
REDIS="${REDIS_URL:-}"
[ -z "$REDIS" ] && REDIS="$(security find-generic-password -s repohq-factory-redis-url -w 2>/dev/null || true)"
if [ -z "$REDIS" ] && [ -f "$ROOT/.env.local" ]; then
  REDIS="$(sed -nE 's/^REDIS_URL=["'"'"']?([^"'"'"']+)["'"'"']?$/\1/p' "$ROOT/.env.local" | head -1)"
fi
if [ -n "$REDIS" ]; then
  security add-generic-password -U -s repohq-factory-redis-url -a "$USER" -w "$REDIS"
  echo "stored REDIS_URL in the login keychain (service repohq-factory-redis-url)"
  INSTALL="com.repohq.factory.worker"
  worker_plist > "$AGENTS/com.repohq.factory.worker.plist"
else
  echo "warning: no REDIS_URL (env, keychain or .env.local) — installing the launchd calendar; Agent HQ requests won't run."
  echo "         Create the Redis from render.yaml, set REDIS_URL and re-run this script to switch to the worker."
  INSTALL="$CALENDAR_LABELS"
  CYCLE_HOURS="20 21 22 23 0 1 2 3 4 5 6 12 16"
  CYCLE_TIMES="$(for h in $CYCLE_HOURS; do printf '    <dict><key>Hour</key><integer>%s</integer><key>Minute</key><integer>5</integer></dict>\n' "$h"; done)"
  plist com.repohq.factory.cycle cycle "<array>
$CYCLE_TIMES
  </array>" > "$AGENTS/com.repohq.factory.cycle.plist"
  plist com.repohq.factory.report report '<dict><key>Hour</key><integer>6</integer><key>Minute</key><integer>45</integer></dict>' > "$AGENTS/com.repohq.factory.report.plist"
  plist com.repohq.factory.scout scout '<dict><key>Weekday</key><integer>0</integer><key>Hour</key><integer>17</integer><key>Minute</key><integer>10</integer></dict>' > "$AGENTS/com.repohq.factory.scout.plist"
fi
unset REDIS

for label in $INSTALL; do
  plutil -lint "$AGENTS/$label.plist" >/dev/null
  launchctl bootstrap "$DOMAIN" "$AGENTS/$label.plist"
done
echo "installed: $INSTALL"
if [ "$INSTALL" = com.repohq.factory.worker ]; then
  echo "status:    the Agents page in RepoHQ (worker online, queue, schedules) · logs in ~/.repohq-factory/logs"
  echo "run now:   Agents page → Run now, or: npm run factory -- --dry-run"
else
  echo "run now:   launchctl kickstart $DOMAIN/com.repohq.factory.cycle"
fi
echo "pause:     touch ~/.repohq-factory/PAUSE"
