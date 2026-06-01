# RepoHQ MCP Server

Exposes your portfolio intelligence to Claude Code (and any MCP-compatible client).

## Setup

### 1. Get your user ID

Sign into RepoHQ, then run this against your Neon database:

```sql
SELECT id, github_login FROM users LIMIT 5;
```

### 2. Add to Claude Code config

Edit `~/.claude/claude.json` (create it if it doesn't exist):

```json
{
  "mcpServers": {
    "repohq": {
      "command": "npx",
      "args": ["tsx", "/Users/davidsmith/Documents/Repos/Github-HQ/RepoHQ/mcp/server.ts"],
      "env": {
        "DATABASE_URL": "postgresql://neondb_owner:...@...neon.tech/neondb?sslmode=require",
        "MCP_USER_ID": "your-user-id-here"
      }
    }
  }
}
```

### 3. Restart Claude Code

The server starts automatically when Claude Code launches.

## Available Tools

| Tool | Description |
|------|-------------|
| `get_portfolio_summary` | Overview: score, grade, advisor headline, focused repos |
| `get_repo_context` | Full context for a specific repo (health, lifecycle, tech debt, security, deployments) |
| `get_portfolio_warnings` | Failing builds, critical security alerts, low-health repos |
| `get_top_opportunities` | Repos ranked by opportunity score with health/activity breakdown |
| `get_active_goals` | Current goals with progress and deadline status |

## Usage examples

Once connected, Claude Code will automatically have access. You can also explicitly ask:

- "What's the context for this repo?" → `get_repo_context`
- "What should I work on this week?" → `get_portfolio_summary` + `get_top_opportunities`
- "Anything on fire right now?" → `get_portfolio_warnings`
- "How are my goals tracking?" → `get_active_goals`
