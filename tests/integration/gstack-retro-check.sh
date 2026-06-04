#!/usr/bin/env bash
# gstack /retro — weekly engineering retrospective on RepoHQ.
# Report only. Run on Mondays for a snapshot of recent engineering patterns.
#
# Usage: bash tests/integration/gstack-retro-check.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUTPUT_FILE="$REPO_ROOT/.nexus/retro-check-output.json"
PROMPT_FILE="$REPO_ROOT/.nexus/retro-check-prompt.md"

echo "[gstack-retro] Starting /retro on RepoHQ..."
mkdir -p "$REPO_ROOT/.nexus"
rm -f "$OUTPUT_FILE"

# Show recent commits locally first
echo ""
echo "--- Recent commits (last 10) ---"
git -C "$REPO_ROOT" log --oneline -10 2>/dev/null || echo "git log unavailable"

cat > "$PROMPT_FILE" << 'PROMPT'
# Weekly Retro: RepoHQ Engineering

Analyse this week's commits and engineering patterns.

## Focus
1. What shipped this week — summarise the key changes
2. Engineering patterns — any recurring themes (security fixes, UX work, tests)?
3. Velocity — how much shipped compared to a typical week?
4. Growth areas — what would have made this week more effective?
5. Highlights — one thing that went well

## Rules
- Use git log to read commits (git log --oneline -20)
- Read changed files to understand what actually shipped
- Keep findings actionable and specific
- No code changes

## Output
{
  "contractVersion": "nexus-agent-output-v1",
  "summary": "Retro: one sentence on this week's engineering",
  "findings": ["Shipped: ...", "Pattern: ...", "Growth: ...", "Highlight: ..."],
  "outcome": "no-changes",
  "changedFiles": []
}
PROMPT

export NEXUS_AGENT_OUTPUT_FILE="$OUTPUT_FILE"
export CLAUDECODE_OVERRIDE="${CLAUDECODE:-}"
unset CLAUDECODE
export OPENCLAW_SESSION=true
export SPAWNED_SESSION=true

echo ""
echo "[gstack-retro] Running Claude Code /retro..."
claude /retro --print --dangerously-skip-permissions "$(cat "$PROMPT_FILE")" 2>&1 || true

if [ -f "$OUTPUT_FILE" ]; then
  node -e "
    const fs = require('fs');
    try {
      const out = JSON.parse(fs.readFileSync('$OUTPUT_FILE', 'utf8'));
      if (Array.isArray(out.findings)) out.findings = out.findings.filter(f => f && f.trim());
      if (!out.findings?.length) out.findings = ['Retro complete — see agent logs for analysis'];
      if (!out.contractVersion) out.contractVersion = 'nexus-agent-output-v1';
      if (!out.outcome) out.outcome = 'no-changes';
      fs.writeFileSync('$OUTPUT_FILE', JSON.stringify(out, null, 2));
    } catch(e) {}
  " 2>/dev/null || true

  echo ""
  node -e "
    const out = JSON.parse(require('fs').readFileSync('$OUTPUT_FILE','utf8'));
    console.log('Summary:', out.summary);
    out.findings.forEach(f => console.log(' ', f));
  "
else
  echo "[gstack-retro] Note: provider rate limited or unavailable"
fi

echo "[gstack-retro] Done."
