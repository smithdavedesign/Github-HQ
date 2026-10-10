#!/usr/bin/env bash
# Nightly backup of the factory's local state to the private repo smithdavedesign/repohq-factory-state.
# Run by launchd (com.user.factory-backup, installed by install-launchd.sh); safe to run by hand.
#
# Backed up: ledger.jsonl (the factory's history: Neon only mirrors part of it), reports/,
# scout-reports/, value-labels/, queue/.
# Never backed up: env, github-app.pem, vercel-bypass.json, himalaya.toml (secrets); context/ (holds
# work-confidential entries, which stay on this Mac); backups/ (third-party personal data); logs/, work/, app/.
set -euo pipefail
SRC="${FACTORY_HOME:-$HOME/.repohq-factory}"
DEST="${FACTORY_BACKUP_DIR:-$HOME/.repohq-factory-backup}"
REPO="${FACTORY_BACKUP_REPO:-smithdavedesign/repohq-factory-state}"
emit() { "$HOME/ai-stack/bin/emit-event" factory backup nightly "$1" "$2" 2>/dev/null || true; }
trap 'emit fail "factory state backup failed (line $LINENO)"' ERR

if [ ! -d "$DEST/.git" ]; then
  gh repo clone "$REPO" "$DEST" -- -q
fi
cd "$DEST"
git pull -q --rebase 2>/dev/null || true
cp "$SRC/ledger.jsonl" ./ledger.jsonl
for d in reports scout-reports value-labels queue; do
  mkdir -p "$d"
  [ -d "$SRC/$d" ] && rsync -a --delete --exclude '.reported' "$SRC/$d/" "$d/"
done
git add -A
if git diff --cached --quiet; then
  emit ok "factory state unchanged since the last backup"
  exit 0
fi
git -c user.name=repohq-backup -c user.email=repohq-backup@users.noreply.github.com commit -q -m "state $(date -u +%Y-%m-%dT%H:%MZ)"
git push -q
emit ok "factory state backed up ($(du -sh ledger.jsonl | cut -f1) ledger, $(git rev-parse --short HEAD))"
