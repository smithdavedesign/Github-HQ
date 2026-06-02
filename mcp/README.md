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

### Diagnostic tools (read-only)

| Tool | Description |
|------|-------------|
| `get_portfolio_summary` | Overview: score, grade, advisor headline, focused repos |
| `get_repo_context` | Full context for a specific repo (health, lifecycle, tech debt, security, deployments) |
| `get_portfolio_warnings` | Failing builds, critical security alerts, low-health repos |
| `get_top_opportunities` | Repos ranked by opportunity score with health/activity breakdown |
| `get_active_goals` | Current goals with progress and deadline status |

### Agentic coding tools (Phase 45)

| Tool | Description |
|------|-------------|
| `get_coding_brief` | Full session-start context doc — health, stack, advisor actions, tech debt, security, recent session history. Paste at session start so the agent never starts cold. |
| `get_next_action` | Single highest-ROI task from advisor + simulation. One concrete thing to execute right now. |
| `log_session_complete` | Record what was accomplished, which agent did it, and what was built. Feeds into future briefs. |

## Usage examples

**Starting a session:**
```
Use get_coding_brief for repohq, then get_next_action
```

**Ending a session:**
```
Use log_session_complete for repohq with summary "Added Gemini provider support and fixed key persistence race condition" and agent_name "Claude Code"
```

**Quick checks:**
- "Anything on fire?" → `get_portfolio_warnings`
- "What should I work on?" → `get_next_action`
- "How are my goals?" → `get_active_goals`
- "Full context for this repo" → `get_coding_brief`
