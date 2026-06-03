#!/usr/bin/env bash
# gstack /health — code quality check on the RepoHQ codebase.
#
# Mirrors the gstack /ship skill's quality assessment phase.
# Checks: TypeScript errors, test coverage, dead code, missing error handling.
#
# Usage:
#   bash tests/integration/gstack-health-check.sh
#
# Requires: claude CLI, ANTHROPIC_API_KEY, run from project root

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUTPUT_FILE="$REPO_ROOT/.nexus/health-check-output.json"
PROMPT_FILE="$REPO_ROOT/.nexus/health-check-prompt.md"

echo "[gstack-health] Starting code health check on RepoHQ..."

mkdir -p "$REPO_ROOT/.nexus"

cat > "$PROMPT_FILE" << 'PROMPT'
# Code Health Assessment: RepoHQ Codebase

You are a senior TypeScript engineer reviewing the RepoHQ Next.js codebase for code quality.

## Checklist
1. TypeScript strictness — are there any `any` types that should be typed? (run: npx tsc --noEmit)
2. Error handling — are server actions wrapped in try/catch? Do they handle DB failures gracefully?
3. Dead code — exported functions that are never imported?
4. Test coverage gaps — which areas of src/lib/actions/ have no tests?
5. Performance — any obvious N+1 queries or missing async parallelism?
6. 'use server' correctness — any non-async exports from 'use server' files?

## Rules
- Run `npm test` and `npm run typecheck` to get actual output
- Only report real issues with file paths, not hypotheticals
- No code changes — assessment only

## Output
Write JSON to NEXUS_AGENT_OUTPUT_FILE:
{
  "contractVersion": "nexus-agent-output-v1",
  "summary": "One sentence health summary",
  "findings": [
    "✅ TypeScript: 0 errors",
    "⚠️ Coverage gap: src/lib/actions/nexus.ts has no unit tests",
    "..."
  ],
  "outcome": "no-changes",
  "changedFiles": [],
  "validationCommand": "npm test && npm run typecheck",
  "healthScore": 0-100
}
PROMPT

export NEXUS_AGENT_OUTPUT_FILE="$OUTPUT_FILE"
export NEXUS_AGENT_PROMPT_FILE="$PROMPT_FILE"

echo "[gstack-health] Running local checks first..."

# Run typecheck and tests locally (fast, no AI needed for this part)
echo ""
echo "--- TypeScript check ---"
cd "$REPO_ROOT" && npm run typecheck 2>&1 | tail -3 && echo "✓ TypeScript clean" || echo "✗ TypeScript errors found"

echo ""
echo "--- Unit tests ---"
npm test 2>&1 | tail -4

echo ""
echo "[gstack-health] Running Claude Code health assessment..."
export CLAUDECODE_OVERRIDE="$CLAUDECODE"
unset CLAUDECODE
cat "$PROMPT_FILE" | claude \
  --print \
  --dangerously-skip-permissions \
  "$(cat "$PROMPT_FILE")" 2>&1 || true

if [ -f "$OUTPUT_FILE" ]; then
  echo ""
  echo "[gstack-health] Validating output contract..."
  node -e "
    const out = JSON.parse(require('fs').readFileSync('$OUTPUT_FILE', 'utf8'));
    const ok = out.contractVersion === 'nexus-agent-output-v1' && Array.isArray(out.findings);
    console.log(ok ? '✓ Contract valid' : '✗ Invalid contract');
    console.log('Health score:', (out.healthScore ?? 'not provided') + '/100');
    out.findings?.forEach(f => console.log(' ', f));
  "
fi

echo "[gstack-health] Done."
