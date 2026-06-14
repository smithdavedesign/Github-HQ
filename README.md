# RepoHQ

**Personal GitHub portfolio intelligence dashboard** — health scoring, AI analysis, revenue tracking, lifecycle management, automated weekly intelligence, and an AI agent execution pipeline for every repo you own.

**Live:** https://repohq.vercel.app · [Architecture](docs/architecture.md) · [Roadmap](docs/roadmap.md)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fsmithdavedesign%2FGithub-HQ&env=DATABASE_URL,GITHUB_CLIENT_ID,GITHUB_CLIENT_SECRET,AUTH_SECRET,ANTHROPIC_API_KEY,CRON_SECRET,NEXTAUTH_URL&envDescription=See%20README%20for%20setup%20instructions&project-name=repohq&repository-name=repohq)

---

## What it does

RepoHQ syncs all your GitHub repos (public + private) and gives you a unified view of your entire portfolio — then acts on it automatically:

- **Health score** — 7-factor weighted score per repo (activity, security, deployments, docs, tests, dependencies, quality)
- **Opportunity score** — revenue potential × activity × health × stars; surfaces what to work on next
- **Portfolio Score** — single 0–100 grade for your whole portfolio with weekly delta
- **AI Advisor** — top 5 quantified actions with exact score deltas and confidence ratings based on past accuracy
- **gstack Skill Launcher** — 9 skills across 5 lifecycle phases launched from the repo Agent tab or via MCP
- **Agent Execution** — queue any advisor action or gstack skill; an AI agent executes via AI-Took-My-Job (Nexus)
- **Advisor Learning Loop** — the advisor tracks predicted vs actual outcomes and improves recommendations over time
- **Auto-Dispatch** — Monday cron automatically queues eligible advisor actions; wake up to PRs ready to review
- **Simulation Engine** — "given 10h this week and a goal of max ARR, here's the optimal allocation"
- **Revenue tracking** — MRR, ARR, costs, P&L per repo; Stripe auto-sync
- **Lifecycle management** — 8 stages from Idea to Archived with abandonment tracking
- **MCP Server** — 14 tools exposing portfolio context + agent lifecycle to Claude Code and MCP-compatible IDEs

---

## Features

**Dashboard**
- Portfolio Score card — circular gauge, A–F grade, component bars, weekly delta
- Portfolio Risk — revenue concentration, single-failure detection, stack exposure
- Weekly Diff — top health mover, new repos, MRR changes, new security alerts (accordion, default 3 rows)
- Plan My Week — simulation engine; greedy ROI-per-hour allocation
- Opportunity Cost — what you worked on vs what had the highest value this week
- GitHub Profile Optimizer — top 6 repos to pin on your GitHub profile
- AI Portfolio Advisor — top 5 actions, expandable cards with full reasoning + confidence badges (🟢🟡🔴⚪) based on historical accuracy
- Agent Impact card — score points gained from agent PRs this month
- CEO Report, Weekly Briefing, Goals, Concentration Risk, Archive Candidates, Lifecycle Distribution

**Repository Matrix**
- TanStack Table — sortable, filterable, column visibility, saved views, CSV export, rows-per-page selector
- Natural language query — `"repos not updated in 6 months with security issues"`
- Open agent PR badge — shows "PR open →" inline when an agent PR is currently in review
- Columns: health, opportunity, valuation, MRR, security, lifecycle, build status, tech debt, framework, database, hosting, AI tools, tags

**Repository Detail**
- Tabs: Overview, Tech Stack, Analysis, Security, Deployments, Revenue, AI Summary
- **Agent tab** — gstack skill launcher (9 skills, 5 phases) + AI advisor actions (expandable, Run Agent button) + agent history (tasks queued, PR status + links, skill reports with inline findings preview, predicted vs actual delta)
- 13-week commit chart, lifecycle + purpose + effort selectors, focus toggle, tags

**gstack Skill Launcher**
- 9 skills grouped by lifecycle phase, launched from the repo Agent tab or `queue_gstack_skill` MCP tool
- Each skill has an editable objective field and live status badges (Queued → Running → Report ready / PR Ready / Failed)
- Inline findings preview shown when a report skill completes — links to full report in Agent History
- Last-run history shown for each skill when idle (days ago + finding count)
- Canary skill auto-hidden if no deployment URL is configured

| Phase | Skills |
|-------|--------|
| Understand | `/investigate` (diagnose + fix), `/review` (code review, report only) |
| Build Quality | `/qa-only` (find bugs, report only), `/qa` (find + fix bugs) |
| Ship | `/ship` (implement + PR), `/document-release` (update docs + CHANGELOG) |
| Monitor | `/health` (code quality score), `/canary` (live app check) |
| Reflect | `/retro` (weekly commit analysis) |

**Agent Execution Pipeline**
- "Run Agent" on any advisor action or gstack skill → POSTs to AI-Took-My-Job (Nexus)
- Agent reads `get_coding_brief` context via MCP before starting
- `skillName` in contextNotes routes the Nexus worker to the correct gstack script
- Skill report outcomes (`agent_skill_report` webhook event) store findings + `suggestedNextSkill`; UI shows inline preview
- Lifecycle guard — prevents duplicate queuing; button hydrates from DB on mount so stage is always accurate
- Full status stages: Queued → Preparing → Running → PR Ready / Report Ready → Merged / Failed / Timed out
- Agent history, attempt log, skill report findings, and PR links on repo detail Agent tab

**Agent Observability**
- `/agent-performance` — accuracy table by action type, success rates, avg delta, trend indicators
- Portfolio Feed — agent events inline (PR opened, merged with actual delta, failed, skill report)
- Repo list — "PR open →" badge linking directly to GitHub PR
- Notifications — in-app bell + optional webhook (Slack, Zapier, Make) for PR ready / failed / health alerts

**Portfolio Feed** — health drops, deployments, security alerts, dependency cascade risk, agent events
- Milestones tab — personal changelog with auto-captured events + manual entries; annual markdown export

**Portfolio Intelligence**
- Triage mode (`/repos/triage`) — keyboard-driven bulk lifecycle decisions
- Idea Graveyard — archived repos with abandonment reasons; advisor warns when actions resemble graveyard ideas
- Dependency Map — internal npm dependency graph on Analytics page
- Lifecycle Distribution, Concentration Risk analysis

**Integrations**
- **Stripe** — restricted API key; maps products to repos; MRR auto-syncs daily
- **AI-Took-My-Job / Nexus** — agent execution pipeline; see [Agentic Execution](#agentic-execution-nexus) below
- **gstack** — real skill invocation via `OPENCLAW_SESSION=true` + Claude Code CLI; G1–G6 fully shipped
- **MCP Server** (`mcp/server.ts`) — 14 tools for Claude Code and any MCP-compatible IDE

**MCP Tools (14)**

| Tool | Description |
|------|-------------|
| `get_portfolio_summary` | Score, grade, top advisor actions, focused repos |
| `get_repo_context` | Full context: health, lifecycle, tech debt, deployments |
| `get_portfolio_warnings` | Failing builds, security alerts, low-health repos |
| `get_top_opportunities` | Repos ranked by opportunity score |
| `get_active_goals` | Goals with progress and deadlines |
| `get_coding_brief` | Session-start doc: health, in-flight PRs, attempt history, last skill report findings |
| `get_next_action` | Top ROI task; skips open PRs + dead ends; includes confidence line |
| `log_session_complete` | Records what was accomplished |
| `get_active_work` | Open agent PRs per repo or portfolio-wide; safe-to-start flag |
| `log_attempt` | Records attempt outcome (success/failed/partial); feeds dead-end detection |
| `get_accuracy_report` | Advisor calibration table by action type + downgraded repos |
| `queue_gstack_skill` | Trigger any of the 9 gstack skills on a repo; returns taskId |
| `get_skill_history` | Recent skill run history for a repo (prose-formatted) |
| `get_skill_findings` | Structured JSON findings from most recent skill run + suggestedNextSkill |

**BYOK (Bring Your Own Key)** — Settings → AI Provider: Claude (Anthropic), GPT-4o (OpenAI), Gemini (Google)

**Public Portfolio**
- `/u/[github-username]` — public view (opt-in in Settings)
- `/u/[username]/resume` — print-friendly portfolio
- `/u/[username]/report/2026-q2` — quarterly report with AI commentary
- Dynamic OG image

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript |
| Styling | Tailwind CSS 4, shadcn/ui (Radix) |
| Table | TanStack Table v8 |
| Data fetching | TanStack Query v5 |
| Charts | Recharts |
| Database | PostgreSQL (Neon serverless HTTP) |
| ORM | Drizzle ORM |
| Auth | Auth.js v5 (GitHub OAuth, DrizzleAdapter) |
| AI | Anthropic Claude API (Sonnet 4.6 + Haiku 4.5), OpenAI, Gemini (BYOK) |
| Hosting | Vercel |
| Crons | GitHub Actions (primary) + Vercel weekly fallback |
| Revenue | Stripe REST API (restricted key, no SDK) |
| IDE | MCP Server (stdio, `@modelcontextprotocol/sdk`) |
| Agent Execution | AI-Took-My-Job / Nexus (BullMQ + Redis) |

---

## Deploy Your Own

### 1. Set up required services

| Service | What you need | Link |
|---------|--------------|------|
| **Neon** | PostgreSQL database connection string | [neon.tech](https://neon.tech) |
| **GitHub OAuth App** | Client ID + Secret | [github.com/settings/developers](https://github.com/settings/developers) |
| **Anthropic** | API key | [console.anthropic.com](https://console.anthropic.com) |

**GitHub OAuth App settings:**
- Homepage URL: `https://your-app.vercel.app`
- Callback URL: `https://your-app.vercel.app/api/auth/callback/github`

For local development, create a **second** OAuth App with `http://localhost:3000` URLs.

### 2. Clone and install

```bash
git clone https://github.com/smithdavedesign/Github-HQ.git repohq
cd repohq
npm install
cp .env.example .env.local
```

### 3. Fill in `.env.local`

```bash
DATABASE_URL=postgresql://...               # Neon connection string
GITHUB_CLIENT_ID=                           # Local OAuth App
GITHUB_CLIENT_SECRET=
AUTH_SECRET=$(openssl rand -base64 32)
ANTHROPIC_API_KEY=sk-ant-...
CRON_SECRET=$(openssl rand -hex 32)
NEXTAUTH_URL=http://localhost:3000
```

### 4. Push schema and run

```bash
npm run db:push     # Push Drizzle schema to Neon
npm run dev
```

Open [localhost:3000](http://localhost:3000), sign in with GitHub, click **Sync**.

### 5. Deploy to Vercel

```bash
vercel --prod
# Or use the Deploy button at the top of this README
```

Set all env vars in Vercel → Project → Settings → Environment Variables. Set `NEXTAUTH_URL` to your production URL.

### 6. Set up GitHub Actions crons

Add `CRON_SECRET` to your GitHub repo → Settings → Secrets → Actions. The workflows in `.github/workflows/` trigger automatically:
- Sync: every 6 hours
- Security: daily
- Deployments: daily
- AI summaries: Sundays
- Digest + Advisor + CEO Report + Auto-Dispatch: Mondays

### 7. (Optional) Connect Stripe

In Settings → Revenue Integration, add a restricted Stripe key with Subscriptions + Products read access.

### 8. (Optional) Connect AI-Took-My-Job (Nexus)

Add to your environment:

```bash
NEXUS_API_URL=https://your-nexus-instance.com
NEXUS_API_TOKEN=your-service-token
NEXUS_WEBHOOK_SECRET=your-webhook-secret
```

The gstack Skill Launcher and Run Agent buttons will activate once these are set. Without Nexus, the UI shows a "not configured" state.

### 9. (Optional) Enable MCP Server

```json
// Add to ~/.claude/claude.json
{
  "mcpServers": {
    "repohq": {
      "command": "npx",
      "args": ["tsx", "/path/to/repohq/mcp/server.ts"],
      "env": {
        "DATABASE_URL": "your-neon-url",
        "MCP_USER_ID": "your-user-id"
      }
    }
  }
}
```

See [mcp/README.md](mcp/README.md) for full setup and tool reference.

---

## Agentic Execution (Nexus)

> **The core thesis:** RepoHQ has Find, Prioritize, and Measure. Nexus adds Execute. That's why this feels different from every other dashboard feature — it's not another card. It's the loop closing.

RepoHQ integrates with **AI-Took-My-Job** (AI-DevOps Nexus) to automatically execute advisor recommendations and gstack skills. When you click "Run Agent" or launch a skill:

1. RepoHQ POSTs to Nexus `/internal/agent-tasks` with the objective, skill name, and acceptance criteria
2. Nexus routes to the correct gstack script based on `skillName` in `contextNotes`
3. The gstack script sets `OPENCLAW_SESSION=true`, injects the RepoHQ coding brief into `CLAUDE.md`, loads learnings from `~/.gstack/projects/{slug}/learnings.jsonl`, and runs Claude Code CLI
4. On completion, Nexus fires a webhook back to `/api/webhooks/agent-events`:
   - `agent_pr_created` → PR link shown in UI, notification dispatched
   - `agent_pr_merged` → accuracy tracking triggered, health re-synced
   - `agent_skill_report` → findings stored, inline preview shown in launcher, `suggestedNextSkill` computed
   - `agent_execution_failed` → error shown in Agent History, notification dispatched
5. UI polls `/api/agent-task-status?taskId=...` per skill for live stage updates

**Lifecycle states:** `idle → queued → preparing → running → pr_ready / report_ready → merged / failed / timed_out / needs_human`

**Auto-dispatch:** Enable in Settings → Agent Auto-Dispatch. Every Monday the advisor automatically queues eligible actions — you wake up with PRs ready to review. Controls: effort gate (quick / quick+medium / all), max tasks per week (1–10), skip security tasks, minimum accuracy threshold.

The Run Agent button hydrates from the database on mount — it always reflects the true current state even after navigation or page refresh. The server also blocks duplicate queuing server-side.

To enable: add `NEXUS_API_URL`, `NEXUS_API_TOKEN`, and `NEXUS_WEBHOOK_SECRET` to your environment.

See [docs/agentic-full-flow.md](docs/agentic-full-flow.md) for architecture diagrams and sequence flows.

---

## gstack Integration

[gstack](https://garryslist.org) is a Claude Code skill framework providing specialised agent workflows (`/ship`, `/investigate`, `/qa`, etc.) with multi-turn planning and a learnings system.

**G1–G6 are fully shipped:**

| Feature | What it does |
|---------|-------------|
| **G1** | Real skill invocation — `claude /investigate`, `claude /ship`, etc. via `OPENCLAW_SESSION=true` |
| **G2** | UI skill launcher on repo Agent tab + `queue_gstack_skill` MCP tool (all 9 skills) |
| **G3** | Learnings injected from `~/.gstack/projects/{slug}/learnings.jsonl` before each run; findings logged back after |
| **G4** | Checkpoint mode (`continuous`) enabled — WIP commits survive crashes; `agent_skill_report` webhook for no-changes outcomes |
| **G5** | RepoHQ brief written to `CLAUDE.md` in worktree — gstack reads it natively as project context |
| **G6** | Dynamic skill router in Nexus agent-runner — `skillName` in `contextNotes` selects the correct script; `GSTACK_SCRIPTS_DIR` for override |

Integration test scripts live in `tests/integration/`. Run from the project root:

```bash
bash tests/integration/gstack-security-check.sh    # /investigate — security
bash tests/integration/gstack-health-check.sh      # /health — code quality
bash tests/integration/gstack-review-check.sh      # /review — code review
bash tests/integration/gstack-qa-only-check.sh     # /qa-only — bug hunt
bash tests/integration/gstack-retro-check.sh       # /retro — weekly analysis
```

**G8 (planned):** 2-hop skill auto-chaining on top of the existing BullMQ parallel execution (concurrency: 3).

See the [gstack Integration Roadmap](docs/roadmap.md#gstack-integration-roadmap) for full details.

---

## Testing

```bash
npm test              # Vitest unit tests (675+ tests, 37 files)
npm run test:e2e      # Playwright e2e tests (requires dev server)
npm run test:all      # both
npm run typecheck     # TypeScript strict check
```

Unit tests cover: health scoring, opportunity scoring, archive scoring, valuation, portfolio score, simulation engine, opportunity cost, event computation, NL query filters, LLM adapter, nexus integration, notifications, MCP tools, advisor accuracy, agent lifecycle, provider mapping, auto-dispatch filter logic, cache TTL, Nexus output contract, security fixes, gstack G7 integration, skill report logic, phase 56 features, CI feedback loop, and more.

Integration scripts (`tests/integration/`) run real gstack-style skill workflows against the RepoHQ codebase via Claude Code CLI and validate the Nexus output.json contract.

---

## Scripts

```bash
npm run dev           # Development server
npm run build         # Production build
npm run typecheck     # tsc --noEmit
npm run lint          # next lint
npm run db:push       # Push Drizzle schema to Neon
npm run db:generate   # Generate migration files
```

---

## Docs

- [Architecture](docs/architecture.md) — system design, scoring formulas, DB schema, risk tiers, design decisions
- [Roadmap](docs/roadmap.md) — all phases shipped + upcoming, gstack roadmap, distribution roadmap
- [Agentic Full Flow](docs/agentic-full-flow.md) — mermaid architecture + sequence diagrams for the agent pipeline
- [Agentic Execution Flow](docs/agentic-execution-flow.md) — quick reference for the execution pipeline
- [gstack Findings](docs/gstack-findings.md) — running log of skill run findings and resolutions
- [MCP Setup](mcp/README.md) — IDE integration guide with all 14 tools
