#!/usr/bin/env bash
# gstack /investigate — security check on the RepoHQ codebase itself.
#
# This script mirrors the gstack-investigate.sh pattern used by Nexus agents
# but runs against THIS repository for local security validation.
#
# Usage:
#   bash tests/integration/gstack-security-check.sh
#   GSTACK_SECURITY_PROVIDER=copilot bash tests/integration/gstack-security-check.sh
#   GSTACK_SECURITY_PROVIDER=copilot COPILOT_SECURITY_CMD='gh copilot -- -p' bash tests/integration/gstack-security-check.sh
#   GSTACK_SECURITY_PROVIDER=codex bash tests/integration/gstack-security-check.sh
#   GSTACK_SECURITY_PROVIDER=codex CODEX_SECURITY_CMD='codex exec --sandbox workspace-write -C .' bash tests/integration/gstack-security-check.sh
#
# Requires:
#   - Provider CLI available (`claude`, `gh`, or `codex`)
#   - Provider auth/env configured (for example ANTHROPIC_API_KEY for Claude)
#   - Run from the project root

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUTPUT_FILE="$REPO_ROOT/.nexus/security-check-output.json"
PROMPT_FILE="$REPO_ROOT/.nexus/security-check-prompt.md"
PROVIDER="${GSTACK_SECURITY_PROVIDER:-claude}"

echo "[gstack-security] Starting security investigation on RepoHQ..."
echo "[gstack-security] Repo root: $REPO_ROOT"

mkdir -p "$REPO_ROOT/.nexus"
rm -f "$OUTPUT_FILE"

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

run_claude() {
  echo "[gstack-security] Running Claude Code security investigation..."
  export CLAUDECODE_OVERRIDE="${CLAUDECODE:-}"
  unset CLAUDECODE
  cat "$PROMPT_FILE" | claude \
    --print \
    --dangerously-skip-permissions \
    "$(cat "$PROMPT_FILE")" 2>&1 || true
}

run_copilot() {
  local cmd response
  cmd="${COPILOT_SECURITY_CMD:-gh copilot -- -p}"

  echo "[gstack-security] Running Copilot security investigation..."
  echo "[gstack-security] Copilot command: $cmd"

  if ! command -v gh >/dev/null 2>&1; then
    echo "[gstack-security] 'gh' command not found"
    echo "[gstack-security] Install GitHub CLI first or set COPILOT_SECURITY_CMD to another command."
    return 0
  fi

  # Run configured Copilot command and keep output for optional JSON extraction.
  response="$($cmd "$(cat "$PROMPT_FILE")" 2>&1 || true)"
  printf '%s\n' "$response"

  # If command did not write NEXUS_AGENT_OUTPUT_FILE but returned JSON, persist it.
  if [ ! -f "$OUTPUT_FILE" ]; then
    node -e "
      const fs = require('fs');
      const text = process.argv[1] || '';
      const outPath = process.argv[2];
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start >= 0 && end > start) {
        const candidate = text.slice(start, end + 1);
        try {
          const parsed = JSON.parse(candidate);
          fs.writeFileSync(outPath, JSON.stringify(parsed, null, 2));
          console.log('[gstack-security] Extracted JSON response to output file');
        } catch {
          // Non-JSON output is allowed; contract validation happens below if file exists.
        }
      }
    " "$response" "$OUTPUT_FILE"
  fi
}

run_codex() {
  local cmd response
  cmd="${CODEX_SECURITY_CMD:-codex exec --sandbox workspace-write -C "$REPO_ROOT"}"

  echo "[gstack-security] Running Codex security investigation..."
  echo "[gstack-security] Codex command: $cmd"

  if ! command -v codex >/dev/null 2>&1; then
    echo "[gstack-security] 'codex' command not found"
    echo "[gstack-security] Install Codex CLI first or set CODEX_SECURITY_CMD to another command."
    return 0
  fi

  response="$($cmd "$(cat "$PROMPT_FILE")" 2>&1 || true)"
  printf '%s\n' "$response"

  # Codex may return the JSON in its final response instead of writing the file.
  if [ ! -f "$OUTPUT_FILE" ]; then
    node -e "
      const fs = require('fs');
      const text = process.argv[1] || '';
      const outPath = process.argv[2];
      const start = text.indexOf('{');
      const end = text.lastIndexOf('}');
      if (start >= 0 && end > start) {
        const candidate = text.slice(start, end + 1);
        try {
          const parsed = JSON.parse(candidate);
          fs.writeFileSync(outPath, JSON.stringify(parsed, null, 2));
          console.log('[gstack-security] Extracted JSON response to output file');
        } catch {
          // Non-JSON output is allowed; contract validation happens below if file exists.
        }
      }
    " "$response" "$OUTPUT_FILE"
  fi
}

case "$PROVIDER" in
  claude)
    run_claude
    ;;
  copilot)
    run_copilot
    ;;
  codex)
    run_codex
    ;;
  *)
    echo "[gstack-security] Unknown provider: $PROVIDER"
    echo "[gstack-security] Supported values: claude | copilot | codex"
    ;;
esac

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
  echo "[gstack-security] Note: no output file written (provider may not have run fully)"
  echo "[gstack-security] For Claude: check ANTHROPIC_API_KEY / usage limits"
  echo "[gstack-security] For Copilot: set COPILOT_SECURITY_CMD to a command that returns JSON or writes NEXUS_AGENT_OUTPUT_FILE"
  echo "[gstack-security] For Codex: run with GSTACK_SECURITY_PROVIDER=codex or set CODEX_SECURITY_CMD"
fi

echo "[gstack-security] Done."
