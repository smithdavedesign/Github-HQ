#!/usr/bin/env bash
# Deploy the factory to ~/.repohq-factory/app and install (or remove with --uninstall) its launchd jobs.
# Merges deploy themselves: com.repohq.factory.deploy (factory/bin/self-deploy.ts) runs this for a green main
# that changed factory code, within 10 minutes. Run it by hand to install, or to deploy at once: it deploys
# origin/main, whatever branch this checkout is on. --head deploys this checkout's HEAD instead (testing a branch on purpose). It first waits for a
# running factory job to finish (up to 20 minutes), since restarting the worker kills it; --now skips that.
#
# With a REDIS_URL (Agent HQ, roadmap Phase 81 — env, keychain, or REDIS_URL in .env.local):
#   com.repohq.factory.worker — the BullMQ worker (factory/worker.ts), always on (KeepAlive). It runs
#                               Agent HQ requests and the scheduled cycle / report / scout, whose
#                               times are now BullMQ job schedulers (factory.config.json `schedules`).
# Without one, the pre-Phase-81 calendar (no Agent HQ requests):
#   com.repohq.factory.cycle  — hourly 22:00–06:00 (the night window) plus 12:00, 14:00 and 16:00 local (≤ 1 PR per cycle,
#                               ≤ maxPrsPerDay per factory day) → 3–8 draft PRs by morning
#   com.repohq.factory.report — 06:45 local: one update per gstack role, emailed
#   com.repohq.factory.scout  — Sundays 17:10 local
# Always:
#   com.user.system-events    — every 5 min: the system-events collector (factory/system, docs/logging.md):
#                               ships ~/.system-events, probes services and jobs, alerts Slack
#   com.user.factory-backup   — 03:30: factory state (ledger, reports) → private repo repohq-factory-state
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

# Restarting the worker kills the job it's running (2026-10-13: a deploy cut off a cycle mid-attempt; it could
# as easily be an owner's request). Wait for it first, up to 20 minutes. --now or --uninstall skip the wait.
wait_for_running_job() {
  case " $* " in *" --now "*|*" --uninstall "*) return 0 ;; esac
  local waited=0
  while pgrep -f 'factory/run[.]ts --scheduled' >/dev/null 2>&1; do
    if [ "$waited" -ge 1200 ]; then echo "a factory job is still running after 20 min: deploying anyway"; return 0; fi
    [ "$waited" -eq 0 ] && echo "a factory job is running: waiting for it to finish (up to 20 min; --now skips this)"
    sleep 15
    waited=$((waited + 15))
  done
}
wait_for_running_job "$@"

CALENDAR_LABELS="com.repohq.factory.cycle com.repohq.factory.report com.repohq.factory.scout"
LABELS="$CALENDAR_LABELS com.repohq.factory.worker com.user.system-events com.user.factory-backup"
# Self-deploy (factory/bin/self-deploy.ts) runs this script from com.repohq.factory.deploy: that job is left alone
# then, since booting it out would kill the deploy halfway.
[ -z "${FACTORY_SELF_DEPLOY:-}" ] && LABELS="$LABELS com.repohq.factory.deploy"
for label in $LABELS; do
  launchctl bootout "$DOMAIN/$label" 2>/dev/null || true
  rm -f "$AGENTS/$label.plist"
done
if [ "${1:-}" = "--uninstall" ]; then
  echo "factory launchd jobs removed"
  exit 0
fi

mkdir -p "$AGENTS" "$HOME/.repohq-factory/logs"

# ── Deploy: a pinned checkout of origin/main, or with --head this checkout's committed HEAD ─────
# Merging is how factory code gets approved (and the factory merges its own PRs now), so an
# unmerged branch is never deployed by accident.
if [ -n "${FACTORY_DEPLOY_SHA:-}" ]; then
  # From self-deploy: the commit it fetched from GitHub and already checked out (launchd can't read ~/Documents).
  SHA="$FACTORY_DEPLOY_SHA"
elif [ "${1:-}" = "--head" ]; then
  SHA="$(git -C "$ROOT" rev-parse HEAD)"
  [ -n "$(git -C "$ROOT" status --porcelain -- factory src/lib/agents)" ] && echo "warning: uncommitted factory changes are NOT deployed (deploying $SHA)"
else
  git -C "$ROOT" fetch -q origin main
  SHA="$(git -C "$ROOT" rev-parse origin/main)"
fi
if [ ! -d "$APP/.git" ]; then
  git clone -q "$ROOT" "$APP"
fi
git -C "$APP" cat-file -e "$SHA^{commit}" 2>/dev/null || git -C "$APP" fetch -q origin "$SHA" 2>/dev/null || git -C "$APP" fetch -q origin
git -C "$APP" checkout -q --detach "$SHA"
(cd "$APP" && npm ci --no-audit --no-fund --silent >/dev/null)
echo "deployed $(git -C "$APP" log -1 --format='%h %s') → $APP"

# ── OpenClaw gets the RepoHQ MCP server read-only (MCP_READONLY=1: no queueing or logging from a chat) ─
# Registered here, after the deploy, so it only ever points at a checkout that has the read-only switch.
if command -v openclaw >/dev/null 2>&1 && [ -f "$APP/mcp/run.sh" ]; then
  openclaw mcp set repohq "{\"command\":\"bash\",\"args\":[\"$APP/mcp/run.sh\"],\"env\":{\"MCP_READONLY\":\"1\"}}" >/dev/null \
    && echo "OpenClaw: repohq MCP server registered (read-only)" \
    || echo "warning: couldn't register the repohq MCP server with OpenClaw"
fi

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
  CYCLE_HOURS="22 23 0 1 2 3 4 5 6 12 14 16"
  CYCLE_TIMES="$(for h in $CYCLE_HOURS; do printf '    <dict><key>Hour</key><integer>%s</integer><key>Minute</key><integer>5</integer></dict>\n' "$h"; done)"
  plist com.repohq.factory.cycle cycle "<array>
$CYCLE_TIMES
  </array>" > "$AGENTS/com.repohq.factory.cycle.plist"
  plist com.repohq.factory.report report '<dict><key>Hour</key><integer>6</integer><key>Minute</key><integer>45</integer></dict>' > "$AGENTS/com.repohq.factory.report.plist"
  plist com.repohq.factory.scout scout '<dict><key>Weekday</key><integer>0</integer><key>Hour</key><integer>17</integer><key>Minute</key><integer>10</integer></dict>' > "$AGENTS/com.repohq.factory.scout.plist"
fi
unset REDIS

# The system-events collector, on the deployed checkout like the worker (secrets come from the keychain).
cat > "$AGENTS/com.user.system-events.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.user.system-events</string>
  <key>ProgramArguments</key>
  <array><string>$APP/node_modules/.bin/tsx</string><string>$APP/factory/bin/events.ts</string><string>collect</string></array>
  <key>WorkingDirectory</key><string>$APP</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string><key>HOME</key><string>$HOME</string></dict>
  <key>StartInterval</key><integer>300</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$HOME/.system-events/collector.log</string>
  <key>StandardErrorPath</key><string>$HOME/.system-events/collector.log</string>
</dict>
</plist>
PLIST
mkdir -p "$HOME/.system-events"
INSTALL="$INSTALL com.user.system-events"

# Nightly backup of the factory's local state (ledger, reports) to a private repo: factory/bin/backup-state.sh.
cat > "$AGENTS/com.user.factory-backup.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.user.factory-backup</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$APP/factory/bin/backup-state.sh</string></array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string><key>HOME</key><string>$HOME</string></dict>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>30</integer></dict>
  <key>StandardOutPath</key><string>$HOME/.system-events/backup.log</string>
  <key>StandardErrorPath</key><string>$HOME/.system-events/backup.log</string>
</dict>
</plist>
PLIST
INSTALL="$INSTALL com.user.factory-backup"

# Self-deploy: every 10 minutes, a green main that changed factory code is deployed (factory/lib/self-deploy.ts).
if [ -z "${FACTORY_SELF_DEPLOY:-}" ]; then
  cat > "$AGENTS/com.repohq.factory.deploy.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.repohq.factory.deploy</string>
  <key>ProgramArguments</key>
  <array><string>$APP/node_modules/.bin/tsx</string><string>$APP/factory/bin/self-deploy.ts</string></array>
  <key>WorkingDirectory</key><string>$APP</string>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string><key>HOME</key><string>$HOME</string></dict>
  <key>StartInterval</key><integer>600</integer>
  <key>StandardOutPath</key><string>$HOME/.repohq-factory/logs/self-deploy.log</string>
  <key>StandardErrorPath</key><string>$HOME/.repohq-factory/logs/self-deploy.log</string>
</dict>
</plist>
PLIST
  INSTALL="$INSTALL com.repohq.factory.deploy"
fi

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
