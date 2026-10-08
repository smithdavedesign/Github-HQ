#!/usr/bin/env bash
# End-to-end check of one factory cycle against a local fixture repo (no GitHub, no PR):
# seeded TypeScript error → scan → route (M0) → Aider via LiteLLM → re-check → judge → squash commit.
# Needs the local AI stack (LiteLLM :4000 with the local-agent alias) and Docker: install, checks and
# Aider run in the sandbox (factory/lib/sandbox.ts), the host only judges and commits.
# Usage: bash factory/eval/e2e.sh            (sandboxed, the default)
#        FACTORY_SANDBOX=off bash factory/eval/e2e.sh   (host execution; trusted fixture only)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

SRC="$TMP/src/e2e-fixture"
mkdir -p "$SRC/src"
cat > "$SRC/package.json" <<'JSON'
{ "name": "e2e-fixture", "private": true, "scripts": { "typecheck": "tsc --noEmit" }, "devDependencies": { "typescript": "5.9.3" } }
JSON
cat > "$SRC/tsconfig.json" <<'JSON'
{ "compilerOptions": { "strict": true, "noEmit": true, "target": "ES2020", "module": "commonjs" }, "include": ["src"] }
JSON
cat > "$SRC/src/price.ts" <<'TS'
export function total(prices: number[]): number {
  const sum: string = prices.reduce((a, b) => a + b, 0)
  return sum
}
TS
printf '# e2e fixture\n\n%s\n\n## Installation\n\nnpm install\n\n## Usage\n\nnpm run typecheck\n' "$(printf 'Fixture repo used by the RepoHQ factory end-to-end check. %.0s' {1..8})" > "$SRC/README.md"
(cd "$SRC" && npm install --no-audit --no-fund --silent >/dev/null && git init -q -b main && git add -A -- . ':!node_modules' && git -c user.email=e2e@local -c user.name=e2e commit -qm init)
git clone -q --bare "$SRC" "$TMP/remotes/local/e2e-fixture.git"

CFG="$TMP/factory.config.json"
echo '{ "repos": ["local/e2e-fixture"], "monthlyBudgetUsd": 0 }' > "$CFG"

cd "$ROOT"
OUT="$(FACTORY_HOME="$TMP/home" FACTORY_CONFIG="$CFG" FACTORY_GIT_URL="file://$TMP/remotes/{repo}.git" \
  npx --no-install tsx factory/run.ts --dry-run --keep --repo=local/e2e-fixture 2>&1)"
echo "$OUT" | grep '^\[factory'

WORK="$(ls -d "$TMP"/home/work/*/local__e2e-fixture)"
fail() { echo "E2E FAILED: $*"; exit 1; }
echo "$OUT" | grep -q 'fix-types → M0' || fail 'task was not routed to M0'
echo "$OUT" | grep -q 'M0 VERIFIED' || fail 'M0 fix was not verified'
[ "$(git -C "$WORK" rev-list --count HEAD)" = 2 ] || fail 'expected exactly one squashed commit on top of base'
# RepoHQ's own tsc: in sandbox mode the host clone never gets node_modules (nothing is installed on the host).
"$ROOT/node_modules/.bin/tsc" -p "$WORK" --noEmit || fail 'typecheck fails on the committed tree'
[ -z "$(git -C "$WORK" status --porcelain)" ] || fail 'worktree not clean after commit'
git -C "$WORK" log -1 --format=%B | grep -q 'RepoHQ Factory (M0' || fail 'commit message missing provenance'
grep -q '"outcome":"verified"' "$TMP/home/ledger.jsonl" || fail 'ledger has no verified attempt'
if [ "${FACTORY_SANDBOX:-docker}" != off ]; then
  echo "$OUT" | grep -q 'M0 aider → local-agent (sandboxed)' || fail 'harness did not run in the sandbox'
  grep -q '"isolation":"docker"' "$TMP/home/ledger.jsonl" || fail 'ledger attempt not marked isolation=docker'
  [ ! -d "$WORK/node_modules" ] || fail 'host clone has node_modules: repo code was installed on the host'
  [ -z "$(docker ps -aq --filter name=repohq-sbx-)" ] || fail 'sandbox containers left behind'
fi
echo "E2E PASSED"
