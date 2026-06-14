#!/usr/bin/env bash
# tests/integration/bootstrap-check.sh
#
# Verifies bootstrap.sh works correctly across different project types.
# Creates isolated temp directories with representative lockfile structures
# and checks detection logic + exit codes.
#
# Usage: bash tests/integration/bootstrap-check.sh
# Requires: bash, npm (in PATH)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BOOTSTRAP="$REPO_ROOT/bootstrap.sh"
PASS=0
FAIL=0
ERRORS=()

pass() { echo "  ✓ $1"; ((PASS++)) || true; }
fail() { echo "  ✗ $1"; ((FAIL++)) || true; ERRORS+=("$1"); }

run_bootstrap() {
  bash "$BOOTSTRAP" 2>&1
}

# ── Test 1: Script is executable and exists ───────────────────────────────────

echo ""
echo "=== bootstrap.sh smoke tests ==="
echo ""

if [ -f "$BOOTSTRAP" ]; then
  pass "bootstrap.sh exists at repo root"
else
  fail "bootstrap.sh missing from repo root"
  exit 1
fi

if [ -x "$BOOTSTRAP" ] || bash -n "$BOOTSTRAP" 2>/dev/null; then
  pass "bootstrap.sh is valid bash (no syntax errors)"
else
  fail "bootstrap.sh has syntax errors"
  exit 1
fi

# ── Test 2: Detects npm from package-lock.json ────────────────────────────────

echo "=== Package manager detection ==="
echo ""

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# npm
cat > "$TMP/package-lock.json" << 'EOF'
{"name":"test","version":"1.0.0","lockfileVersion":3,"requires":true,"packages":{}}
EOF
cat > "$TMP/package.json" << 'EOF'
{"name":"test","version":"1.0.0","scripts":{}}
EOF

OUTPUT=$(cd "$TMP" && bash "$BOOTSTRAP" 2>&1 || true)
if echo "$OUTPUT" | grep -q "Detected npm"; then
  pass "detects npm when package-lock.json present"
else
  fail "did not detect npm — output: $OUTPUT"
fi

# yarn
rm -f "$TMP/package-lock.json"
touch "$TMP/yarn.lock"
OUTPUT=$(cd "$TMP" && bash "$BOOTSTRAP" 2>&1 || true)
if echo "$OUTPUT" | grep -q "Detected yarn"; then
  pass "detects yarn when yarn.lock present"
else
  fail "did not detect yarn — output: $OUTPUT"
fi

# pnpm
rm -f "$TMP/yarn.lock"
touch "$TMP/pnpm-lock.yaml"
OUTPUT=$(cd "$TMP" && bash "$BOOTSTRAP" 2>&1 || true)
if echo "$OUTPUT" | grep -q "Detected pnpm"; then
  pass "detects pnpm when pnpm-lock.yaml present"
else
  fail "did not detect pnpm — output: $OUTPUT"
fi

# bun
rm -f "$TMP/pnpm-lock.yaml"
touch "$TMP/bun.lock"
OUTPUT=$(cd "$TMP" && bash "$BOOTSTRAP" 2>&1 || true)
if echo "$OUTPUT" | grep -q "Detected bun"; then
  pass "detects bun when bun.lock present"
else
  fail "did not detect bun — output: $OUTPUT"
fi

# ── Test 3: Non-JS repo with no package.json ─────────────────────────────────

echo ""
echo "=== Non-JS repo handling ==="
echo ""

TMP2=$(mktemp -d)
trap 'rm -rf "$TMP" "$TMP2"' EXIT

# Empty directory — should exit 0 and not crash
EXIT_CODE=0
cd "$TMP2" && bash "$BOOTSTRAP" > /dev/null 2>&1 || EXIT_CODE=$?
if [ "$EXIT_CODE" -eq 0 ]; then
  pass "exits 0 for repo with no recognised package manager"
else
  fail "unexpectedly exited $EXIT_CODE for empty repo"
fi

cd "$REPO_ROOT"

# ── Test 4: Runs successfully on THIS repo ────────────────────────────────────

echo ""
echo "=== Run on RepoHQ itself ==="
echo ""

OUTPUT=$(cd "$REPO_ROOT" && run_bootstrap)

if echo "$OUTPUT" | grep -q "Detected npm"; then
  pass "correctly identifies RepoHQ as npm project"
else
  fail "did not identify npm in RepoHQ output"
fi

if echo "$OUTPUT" | grep -q "tsc:"; then
  pass "tsc is available after bootstrap"
else
  fail "tsc not found in output — deps may not have installed"
fi

if echo "$OUTPUT" | grep -q "eslint:"; then
  pass "eslint is available after bootstrap"
else
  fail "eslint not found in output"
fi

if echo "$OUTPUT" | grep -q "Bootstrap complete"; then
  pass "bootstrap reports completion"
else
  fail "bootstrap did not print completion message"
fi

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo "=================================================="
echo "Results: $PASS passed, $FAIL failed"

if [ "${#ERRORS[@]}" -gt 0 ]; then
  echo ""
  echo "Failures:"
  for e in "${ERRORS[@]}"; do
    echo "  - $e"
  done
  echo ""
  exit 1
fi

echo ""
echo "All bootstrap checks passed."
exit 0
