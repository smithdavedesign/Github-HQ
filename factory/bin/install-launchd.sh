#!/usr/bin/env bash
# Deploy the factory to ~/.repohq-factory/app and install (or remove with --uninstall) its launchd schedules.
# Re-run after committing factory changes to redeploy.
#   com.repohq.factory.cycle  — hourly 20:00–05:00 plus 12:00 and 16:00 local (≤ 1 PR per cycle,
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

LABELS="com.repohq.factory.cycle com.repohq.factory.report com.repohq.factory.scout"
for label in $LABELS; do
  launchctl bootout "$DOMAIN/$label" 2>/dev/null || true
  rm -f "$AGENTS/$label.plist"
done
if [ "${1:-}" = "--uninstall" ]; then
  echo "factory schedules removed"
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

# ── Secret for the optional RepoHQ sink: macOS keychain, not a plaintext file ─
if [ -f "$ROOT/.env.local" ] && ! security find-generic-password -s repohq-factory-database-url >/dev/null 2>&1; then
  DB_URL="$(sed -nE 's/^DATABASE_URL=["'"'"']?([^"'"'"']+)["'"'"']?$/\1/p' "$ROOT/.env.local" | head -1)"
  if [ -n "$DB_URL" ]; then
    security add-generic-password -U -s repohq-factory-database-url -a "$USER" -w "$DB_URL"
    echo "stored RepoHQ DATABASE_URL in the login keychain (service repohq-factory-database-url)"
  fi
  unset DB_URL
fi
CYCLE_HOURS="20 21 22 23 0 1 2 3 4 5 12 16"
CYCLE_TIMES="$(for h in $CYCLE_HOURS; do printf '    <dict><key>Hour</key><integer>%s</integer><key>Minute</key><integer>5</integer></dict>\n' "$h"; done)"
plist com.repohq.factory.cycle cycle "<array>
$CYCLE_TIMES
  </array>" > "$AGENTS/com.repohq.factory.cycle.plist"
plist com.repohq.factory.report report '<dict><key>Hour</key><integer>6</integer><key>Minute</key><integer>45</integer></dict>' > "$AGENTS/com.repohq.factory.report.plist"
plist com.repohq.factory.scout scout '<dict><key>Weekday</key><integer>0</integer><key>Hour</key><integer>17</integer><key>Minute</key><integer>10</integer></dict>' > "$AGENTS/com.repohq.factory.scout.plist"

for label in $LABELS; do
  plutil -lint "$AGENTS/$label.plist" >/dev/null
  launchctl bootstrap "$DOMAIN" "$AGENTS/$label.plist"
done
echo "installed: $(launchctl list | grep -c com.repohq.factory) factory schedules"
echo "run now:   launchctl kickstart $DOMAIN/com.repohq.factory.cycle"
echo "pause:     touch ~/.repohq-factory/PAUSE"
