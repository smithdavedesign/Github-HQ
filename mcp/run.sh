#!/usr/bin/env bash
# Start the RepoHQ MCP server with secrets from the login keychain (nothing in ~/.claude.json).
# Registered for Claude Code at user scope:
#   claude mcp add -s user repohq -- bash ~/.repohq-factory/app/mcp/run.sh
set -euo pipefail
dir="$(cd "$(dirname "$0")/.." && pwd)"
DATABASE_URL="$(security find-generic-password -s repohq-factory-database-url -w)"
MCP_USER_ID="$(grep '^FACTORY_USER_ID=' "$HOME/.repohq-factory/env" | cut -d= -f2-)"
export DATABASE_URL MCP_USER_ID
exec "$dir/node_modules/.bin/tsx" "$dir/mcp/server.ts"
