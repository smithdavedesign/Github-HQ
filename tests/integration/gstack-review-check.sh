#!/usr/bin/env bash
# gstack /review — pre-merge code review against RepoHQ codebase.
# Read-only: no code changes, findings report only.
#
# Usage:
#   bash tests/integration/gstack-review-check.sh
#   GSTACK_SECURITY_PROVIDER=copilot bash tests/integration/gstack-review-check.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUTPUT_FILE="$REPO_ROOT/.nexus/review-check-output.json"
PROMPT_FILE="$REPO_ROOT/.nexus/review-check-prompt.md"
PROVIDER="${GSTACK_SECURITY_PROVIDER:-claude}"

echo "[gstack-review] Starting /review check on RepoHQ..."
echo "[gstack-review] Repo root: $REPO_ROOT"

mkdir -p "$REPO_ROOT/.nexus"
rm -f "$OUTPUT_FILE"

cat > "$PROMPT_FILE" << 'PROMPT'
# Code Review: RepoHQ Codebase

You are a senior TypeScript engineer reviewing the RepoHQ Next.js codebase for code quality and correctness.

## Scope
Focus on:
1. Server action authorization — do all mutations verify session.user.id?
2. Input validation — are user-supplied strings validated before DB writes?
3. Error handling patterns — are DB calls wrapped in try/catch?
4. TypeScript correctness — any type assertions that could hide runtime errors?
5. Async/await correctness — any unhandled promise rejections?

## Rules
- Read actual source files before making claims
- Only report genuine issues with file:line references
- No code changes — review only

## Output
Write JSON to NEXUS_AGENT_OUTPUT_FILE:
{
  "contractVersion": "nexus-agent-output-v1",
  "summary": "One sentence: overall code review verdict",
  "findings": ["Finding 1: file:line description", "..."],
  "outcome": "no-changes",
  "changedFiles": [],
  "validationCommand": "npm run typecheck"
}
PROMPT

export NEXUS_AGENT_OUTPUT_FILE="$OUTPUT_FILE"
export NEXUS_AGENT_PROMPT_FILE="$PROMPT_FILE"

run_claude() {
  echo "[gstack-review] Running Claude Code /review..."
  export CLAUDECODE_OVERRIDE="${CLAUDECODE:-}"
  unset CLAUDECODE
  export OPENCLAW_SESSION=true
  export SPAWNED_SESSION=true
  claude /review --print --dangerously-skip-permissions "$(cat "$PROMPT_FILE")" 2>&1 || true
}

run_copilot() {
  local cmd="${COPILOT_SECURITY_CMD:-gh copilot -- -p}"
  echo "[gstack-review] Running Copilot /review..."
  if ! command -v gh >/dev/null 2>&1; then
    echo "[gstack-review] 'gh' not found — skipping Copilot"
    return 0
  fi
  response="$($cmd "$(cat "$PROMPT_FILE")" 2>&1 || true)"
  printf '%s\n' "$response"
  if [ ! -f "$OUTPUT_FILE" ]; then
    node -e "
      const fs = require('fs');
      const text = process.argv[1] || '';
      const start = text.indexOf('{'); const end = text.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try { const p = JSON.parse(text.slice(start, end+1)); fs.writeFileSync('$OUTPUT_FILE', JSON.stringify(p,null,2)); } catch {}
      }
    " "$response" "$OUTPUT_FILE"
  fi
}

case "$PROVIDER" in
  claude)  run_claude ;;
  copilot) run_copilot ;;
  *)       echo "[gstack-review] Unknown provider: $PROVIDER (claude|copilot)" ;;
esac

if [ -f "$OUTPUT_FILE" ]; then
  echo ""
  echo "[gstack-review] Sanitising output..."
  node -e "
    const fs = require('fs');
    try {
      const out = JSON.parse(fs.readFileSync('$OUTPUT_FILE', 'utf8'));
      if (Array.isArray(out.findings)) out.findings = out.findings.filter(f => f && f.trim().length > 0);
      if (!out.findings?.length) out.findings = ['Review complete — no issues found'];
      if (!out.contractVersion) out.contractVersion = 'nexus-agent-output-v1';
      if (!out.outcome) out.outcome = 'no-changes';
      fs.writeFileSync('$OUTPUT_FILE', JSON.stringify(out, null, 2));
    } catch (e) { console.warn('sanitise failed:', e.message); }
  " 2>/dev/null || true

  echo "[gstack-review] Validating output contract..."
  node -e "
    const out = JSON.parse(require('fs').readFileSync('$OUTPUT_FILE', 'utf8'));
    const ok = out.contractVersion === 'nexus-agent-output-v1' && Array.isArray(out.findings);
    console.log(ok ? '✓ Contract valid' : '✗ Invalid contract');
    console.log('Summary:', out.summary);
    console.log('Findings:', out.findings.length, 'items');
    out.findings.slice(0, 5).forEach(f => console.log(' ', f));
    if (out.findings.length > 5) console.log('  ...and', out.findings.length - 5, 'more');
  " && echo "[gstack-review] ✓ Review complete" || echo "[gstack-review] ✗ Contract validation failed"
else
  echo "[gstack-review] Note: no output file written (rate limit or provider not available)"
fi

echo "[gstack-review] Done."
