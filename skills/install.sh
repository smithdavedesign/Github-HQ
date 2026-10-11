#!/usr/bin/env bash
# Link the system's own skills into ~/.claude/skills so every Claude Code session has them.
# Kept in git (here and in idea-factory), not inside gstack, so a gstack upgrade can't remove them.
#   bash skills/install.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
dest="$HOME/.claude/skills"
mkdir -p "$dest"
link() {
  local to="$dest/$(basename "$1")"
  # A real folder in the way (a skill installed by hand before it was in git): replace it only if it matches.
  if [ -d "$to" ] && [ ! -L "$to" ]; then
    if diff -rq "$1" "$to" >/dev/null; then rm -rf "$to"; else echo "skipped $(basename "$1"): $to differs from $1"; return 0; fi
  fi
  ln -sfn "$1" "$to" && echo "linked $(basename "$1") → $1"
}
for d in "$here"/*/; do [ -f "$d/SKILL.md" ] && link "${d%/}"; done
idea="$HOME/idea-factory/skills"
stack="$HOME/ai-stack/skills"
for root in "$idea" "$stack"; do
  if [ -d "$root" ]; then for d in "$root"/*/; do [ -f "$d/SKILL.md" ] && link "${d%/}"; done; fi
done

# OpenClaw (the companion on Slack and WhatsApp) loads idea-factory's and ai-stack's skills from their own
# folders: it refuses symlinks that leave ~/.openclaw/skills. idea-review stays off there (the pipeline runs
# it). Not portfolio-context: its generated system brief does that job, and launchd can't read ~/Documents.
if command -v openclaw >/dev/null 2>&1; then
  openclaw config set skills.load.extraDirs "[\"$idea\",\"$stack\"]" --strict-json >/dev/null \
    && openclaw config set skills.entries.idea-review.enabled false --strict-json >/dev/null \
    && echo "OpenClaw: loads $idea and $stack (idea-review off); restart the gateway to apply"
fi
