#!/usr/bin/env bash
# Link the system's own skills into ~/.claude/skills so every Claude Code session has them.
# Kept in git (here and in idea-factory), not inside gstack, so a gstack upgrade can't remove them.
#   bash skills/install.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
dest="$HOME/.claude/skills"
mkdir -p "$dest"
link() { ln -sfn "$1" "$dest/$(basename "$1")" && echo "linked $(basename "$1") → $1"; }
for d in "$here"/*/; do [ -f "$d/SKILL.md" ] && link "${d%/}"; done
idea="$HOME/idea-factory/skills"
if [ -d "$idea" ]; then for d in "$idea"/*/; do [ -f "$d/SKILL.md" ] && link "${d%/}"; done; fi
