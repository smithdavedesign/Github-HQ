#!/usr/bin/env bash
# bootstrap.sh — Prepare any repo for agent checks (health, lint, typecheck, etc.)
#
# Usage: bash bootstrap.sh
#
# Run this FIRST in any Nexus / CI worktree before executing gstack skills or
# running checks.  It detects the package manager and tech stack, installs
# dependencies, and verifies the toolchain is usable.
#
# Exits non-zero on failure — callers should abort rather than continue with a
# broken environment.

set -euo pipefail

log()  { echo "[bootstrap] $*"; }
err()  { echo "[bootstrap] ERROR: $*" >&2; }
fail() { err "$*"; exit 1; }

# ── 1. Detect package manager ─────────────────────────────────────────────────

install_deps() {
  if [ -f "package-lock.json" ]; then
    log "Detected npm (package-lock.json)"
    npm ci
  elif [ -f "yarn.lock" ]; then
    log "Detected yarn (yarn.lock)"
    yarn install --frozen-lockfile
  elif [ -f "pnpm-lock.yaml" ]; then
    log "Detected pnpm (pnpm-lock.yaml)"
    pnpm install --frozen-lockfile
  elif [ -f "bun.lockb" ] || [ -f "bun.lock" ]; then
    log "Detected bun (bun.lock)"
    bun install --frozen-lockfile
  elif [ -f "package.json" ]; then
    log "Found package.json but no lockfile — falling back to npm install"
    npm install
  else
    log "No package.json found — skipping JS dependency install"
    return 0
  fi
}

# ── 2. Detect other tech stacks ───────────────────────────────────────────────

install_python() {
  if [ -f "pyproject.toml" ] && command -v uv &>/dev/null; then
    log "Detected Python/uv (pyproject.toml)"
    uv sync
  elif [ -f "requirements.txt" ]; then
    log "Detected Python (requirements.txt)"
    pip install -r requirements.txt
  elif [ -f "Pipfile" ]; then
    log "Detected Python/Pipenv"
    pipenv install
  fi
}

install_ruby() {
  if [ -f "Gemfile" ]; then
    log "Detected Ruby (Gemfile)"
    bundle install
  fi
}

install_go() {
  if [ -f "go.mod" ]; then
    log "Detected Go (go.mod)"
    go mod download
  fi
}

install_rust() {
  if [ -f "Cargo.toml" ]; then
    log "Detected Rust (Cargo.toml)"
    cargo fetch
  fi
}

# ── 3. Run installs ───────────────────────────────────────────────────────────

log "Starting bootstrap in $(pwd)"

install_deps
install_python
install_ruby
install_go
install_rust

# ── 4. Verify JS toolchain (if this is a JS/TS project) ──────────────────────

if [ -f "package.json" ]; then
  log "Verifying JS toolchain..."

  if [ -f "tsconfig.json" ]; then
    if npx tsc --version &>/dev/null; then
      log "  tsc: $(npx tsc --version)"
    else
      fail "tsc not available after install — check tsconfig.json and TypeScript dependency"
    fi
  fi

  if [ -f "eslint.config.mjs" ] || [ -f ".eslintrc.js" ] || [ -f ".eslintrc.json" ] || [ -f ".eslintrc.cjs" ]; then
    if npx eslint --version &>/dev/null; then
      log "  eslint: $(npx eslint --version)"
    else
      fail "eslint not available after install — check eslint dependency"
    fi
  fi
fi

log "Bootstrap complete — environment is ready for checks."
