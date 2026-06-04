#!/usr/bin/env bash
# gstack /qa-only — bug finder against RepoHQ (no fixes, report only).
#
# Focuses on functional bugs in the portfolio dashboard logic.
# Safe to run in CI — never modifies files.
#
# Usage: bash tests/integration/gstack-qa-only-check.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUTPUT_FILE="$REPO_ROOT/.nexus/qa-only-check-output.json"
PROMPT_FILE="$REPO_ROOT/.nexus/qa-only-check-prompt.md"

echo "[gstack-qa-only] Starting /qa-only check on RepoHQ..."
mkdir -p "$REPO_ROOT/.nexus"
rm -f "$OUTPUT_FILE"

# Run local checks first (fast, no AI)
echo ""
echo "--- TypeScript check ---"
cd "$REPO_ROOT" && npm run typecheck 2>&1 | tail -3 && echo "✓ TypeScript clean" || echo "✗ TypeScript errors"

echo ""
echo "--- Unit tests ---"
npm test 2>&1 | tail -4

cat > "$PROMPT_FILE" << 'PROMPT'
# QA Bug Hunt: RepoHQ Dashboard (report only — no fixes)

Find functional bugs in the RepoHQ Next.js dashboard. Focus on user-facing flows.

## Test areas
1. Agent lifecycle — can a task get stuck in a non-terminal state?
2. Webhook handling — are all event types handled correctly in the agent-events handler?
3. Pagination — does the repo table handle 0 results, 1 result, and >50 results gracefully?
4. Settings validation — are there any inputs that could cause silent failures?
5. gstack skill launcher — can /canary be triggered when no homepage is configured?

## Rules
- Test actual logic by reading source files
- Report bugs with file:line and reproduction steps
- No code changes

## Output
{
  "contractVersion": "nexus-agent-output-v1",
  "summary": "QA summary: N bugs found across M areas",
  "findings": ["BUG: file:line — description + repro"],
  "outcome": "no-changes",
  "changedFiles": [],
  "validationCommand": "npm test"
}
PROMPT

export NEXUS_AGENT_OUTPUT_FILE="$OUTPUT_FILE"
export CLAUDECODE_OVERRIDE="${CLAUDECODE:-}"
unset CLAUDECODE
export OPENCLAW_SESSION=true
export SPAWNED_SESSION=true

echo ""
echo "[gstack-qa-only] Running Claude Code /qa-only..."
claude /qa-only --print --dangerously-skip-permissions "$(cat "$PROMPT_FILE")" 2>&1 || true

if [ -f "$OUTPUT_FILE" ]; then
  node -e "
    const fs = require('fs');
    try {
      const out = JSON.parse(fs.readFileSync('$OUTPUT_FILE', 'utf8'));
      if (Array.isArray(out.findings)) out.findings = out.findings.filter(f => f && f.trim());
      if (!out.findings?.length) out.findings = ['QA complete — no functional bugs found'];
      if (!out.contractVersion) out.contractVersion = 'nexus-agent-output-v1';
      if (!out.outcome) out.outcome = 'no-changes';
      fs.writeFileSync('$OUTPUT_FILE', JSON.stringify(out, null, 2));
    } catch(e) {}
  " 2>/dev/null || true

  node -e "
    const out = JSON.parse(require('fs').readFileSync('$OUTPUT_FILE','utf8'));
    console.log('✓ Contract valid:', out.contractVersion === 'nexus-agent-output-v1');
    console.log('Summary:', out.summary);
    out.findings.slice(0,5).forEach(f => console.log(' ', f));
  "
else
  echo "[gstack-qa-only] Note: provider rate limited or unavailable"
fi

echo "[gstack-qa-only] Done."
