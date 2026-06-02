#!/usr/bin/env bash
# gstack /investigate — security check on the RepoHQ codebase itself.
#
# This script mirrors the gstack-investigate.sh pattern used by Nexus agents
# but runs against THIS repository for local security validation.
#
# Usage:
#   bash tests/integration/gstack-security-check.sh
#
# Requires:
#   - `claude` CLI available (npx claude or ~/.claude/bin/claude)
#   - ANTHROPIC_API_KEY set
#   - Run from the project root

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUTPUT_FILE="$REPO_ROOT/.nexus/security-check-output.json"
PROMPT_FILE="$REPO_ROOT/.nexus/security-check-prompt.md"

echo "[gstack-security] Starting security investigation on RepoHQ..."
echo "[gstack-security] Repo root: $REPO_ROOT"

mkdir -p "$REPO_ROOT/.nexus"

# Write investigation prompt
cat > "$PROMPT_FILE" << 'PROMPT'
# Security Investigation: RepoHQ Codebase

You are a security-focused software engineer reviewing the RepoHQ Next.js application.

## Scope
Investigate the following areas for security vulnerabilities:
1. Authentication & session handling (src/lib/auth.ts, src/proxy.ts)
2. Server action authorization (src/lib/actions/*.ts) — do all actions verify auth?
3. API route guards (src/app/api/) — are cron + webhook endpoints properly protected?
4. SQL injection risks (raw SQL usage, Drizzle ORM consistency)
5. Secret handling (env vars, no hardcoded keys in code)
6. Input validation (URL validation, user-supplied data sanitization)

## Rules
- Read the actual source files before making any claims
- Only report genuine findings, not theoretical risks without code evidence
- Do NOT make any code changes — this is investigation only

## Output
After investigating, write a JSON file to the path specified in NEXUS_AGENT_OUTPUT_FILE with this exact structure:
{
  "contractVersion": "nexus-agent-output-v1",
  "summary": "One sentence: overall security posture and top finding",
  "findings": [
    "Finding 1: specific issue with file path and line reference",
    "Finding 2: ...",
    "No critical vulnerabilities found (if clean)"
  ],
  "outcome": "no-changes",
  "changedFiles": [],
  "validationCommand": "npm run typecheck",
  "securityScore": 0-100
}
PROMPT

# Set up environment
export NEXUS_AGENT_OUTPUT_FILE="$OUTPUT_FILE"
export NEXUS_AGENT_PROMPT_FILE="$PROMPT_FILE"

# Run Claude Code in --print mode (investigation only — no changes)
echo "[gstack-security] Running Claude Code security investigation..."
cat "$PROMPT_FILE" | npx --yes claude@latest \
  --print \
  --dangerously-skip-permissions \
  "$(cat "$PROMPT_FILE")" 2>&1 || true

# Validate output if it was written
if [ -f "$OUTPUT_FILE" ]; then
  echo ""
  echo "[gstack-security] Output written to $OUTPUT_FILE"
  echo "[gstack-security] Validating output contract..."

  # Check required fields
  node -e "
    const fs = require('fs');
    const out = JSON.parse(fs.readFileSync('$OUTPUT_FILE', 'utf8'));
    const required = ['contractVersion', 'summary', 'findings', 'outcome'];
    const missing = required.filter(k => !(k in out));
    if (missing.length > 0) {
      console.error('Missing required fields:', missing.join(', '));
      process.exit(1);
    }
    if (out.contractVersion !== 'nexus-agent-output-v1') {
      console.error('Invalid contractVersion:', out.contractVersion);
      process.exit(1);
    }
    console.log('✓ Output contract valid');
    console.log('Summary:', out.summary);
    console.log('Findings:', out.findings.length, 'items');
    console.log('Outcome:', out.outcome);
    if (out.securityScore !== undefined) {
      console.log('Security score:', out.securityScore + '/100');
    }
  " && echo "[gstack-security] ✓ Security check complete" || echo "[gstack-security] ✗ Contract validation failed"
else
  echo "[gstack-security] Note: no output file written (Claude may not have run fully)"
  echo "[gstack-security] This is expected in CI without ANTHROPIC_API_KEY"
fi

echo "[gstack-security] Done."
