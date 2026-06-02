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

### Learning loop (Phase 52)

| Tool | Description |
|------|-------------|
| `get_accuracy_report` | Full advisor calibration table — success rate, avg health delta, and signal strength per action type (security/health/opportunity/revenue). Also lists repos that have been downgraded due to repeated failures. **Call this before queuing actions** to understand which types have a proven track record. |

### Agentic coding tools (Phase 45–51)

| Tool | Description |
|------|-------------|
| `get_coding_brief` | Full session-start context doc — health, stack, advisor actions, tech debt, security, any **in-flight agent PRs**, recent **attempt history**, and session history. Paste at session start so the agent never starts cold. |
| `get_next_action` | Single highest-ROI task from advisor + simulation. Skips repos with open agent PRs (collision prevention) and known dead-end actions (failure feedback). |
| `log_session_complete` | Record what was accomplished, which agent did it, and what was built. Feeds into future briefs. |
| `get_active_work` | Check what agent work is currently in flight for a specific repo or your whole portfolio. **Call this before starting any automated work on a repo** to avoid PR collisions. |
| `log_attempt` | Record the outcome of an automated action (success / failed / partial) with a reason. Failed attempts accumulate — after 2 failures on the same (repo, action) pair the advisor stops recommending it. |

## Usage examples

**Starting an automated session:**
```
Use get_active_work for repohq — check if safe to start
Use get_coding_brief for repohq — includes in-flight PRs and past attempt history
Use get_next_action — returns top action, skipping open PRs and dead ends
```

**After attempting an action:**
```
Use log_attempt for repohq with action "fix CVE-2024-1234" outcome "failed" reason "no matching patch available yet"
```

**Ending a session:**
```
Use log_session_complete for repohq with summary "Added Gemini provider support and fixed key persistence race condition" and agent_name "Claude Code"
```

**Quick checks:**
- "Anything on fire?" → `get_portfolio_warnings`
- "What should I work on?" → `get_next_action`
- "Is anything running on this repo?" → `get_active_work`
- "How are my goals?" → `get_active_goals`
- "Full context for this repo" → `get_coding_brief`
