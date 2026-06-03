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
- **Agent Execution** — queue any advisor action; an AI agent opens a PR automatically (via AI-Took-My-Job / Nexus)
- **Advisor Learning Loop** — the advisor tracks predicted vs actual outcomes and improves recommendations over time
- **Simulation Engine** — "given 10h this week and a goal of max ARR, here's the optimal allocation"
- **Revenue tracking** — MRR, ARR, costs, P&L per repo; Stripe auto-sync
- **Lifecycle management** — 8 stages from Idea to Archived with abandonment tracking
- **MCP Server** — 11 tools exposing portfolio context + agent lifecycle to Claude Code and MCP-compatible IDEs

---

## Features

**Dashboard**
- Portfolio Score card — circular gauge, A–F grade, component bars, weekly delta
- Portfolio Risk — revenue concentration, single-failure detection, stack exposure
- Weekly Diff — top health mover, new repos, MRR changes, new security alerts (accordion, default 3 rows)
- Plan My Week — simulation engine; greedy ROI-per-hour allocation
- Opportunity Cost — what you worked on vs what had the highest value this week
- GitHub Profile Optimizer — top 6 repos to pin on your GitHub profile
- AI Portfolio Advisor — top 5 actions, expandable cards with full reasoning + "Agent will verify" checklist, confidence badges (🟢🟡🔴⚪) based on historical accuracy
- Agent Impact card — score points gained from agent PRs this month
- CEO Report, Weekly Briefing, Goals, Concentration Risk, Archive Candidates, Lifecycle Distribution

**Repository Matrix**
- TanStack Table — sortable, filterable, column visibility, saved views, CSV export, rows-per-page selector
- Natural language query — `"repos not updated in 6 months with security issues"`
- Open agent PR badge — shows "PR open →" inline when an agent PR is currently in review
- Columns: health, opportunity, valuation, MRR, security, lifecycle, build status, tech debt, framework, database, hosting, AI tools, tags

**Repository Detail**
- Tabs: Overview, Tech Stack, Analysis, Security, Deployments, Revenue, AI Summary
- **Agent tab** — AI advisor recommendations for this repo (expandable, Run Agent button) + agent history (tasks queued, PR status + links, attempt log, predicted vs actual delta)
- 13-week commit chart, lifecycle + purpose + effort selectors, focus toggle, tags

**Agent Execution Pipeline**
- "Run Agent" on any advisor action → queues to AI-Took-My-Job (Nexus)
- Agent reads `get_coding_brief` context via MCP before starting
- Auto-executes for quick/medium tasks; substantial tasks queue for human review
- PR created automatically → webhook back to RepoHQ → notification + UI update
- **Lifecycle guard** — prevents duplicate queuing; button hydrates from DB on mount so stage is always accurate
- Full status stages: Queued → Preparing → Running → PR Ready → Merged / Failed / Timed out
- Agent history, attempt log, and PR links on repo detail Agent tab

**Agent Observability**
- `/agent-performance` — accuracy table by action type, success rates, avg delta, trend indicators
- Portfolio Feed — agent events inline (PR opened, merged with actual delta, failed)
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
- **gstack** — execution wrappers (`/ship`, `/investigate` style); see [gstack Integration](#gstack-integration) below
- **MCP Server** (`mcp/server.ts`) — 11 tools for Claude Code and any MCP-compatible IDE

**MCP Tools (11)**

| Tool | Description |
|------|-------------|
| `get_portfolio_summary` | Score, grade, top advisor actions, focused repos |
| `get_repo_context` | Full context: health, lifecycle, tech debt, deployments |
| `get_portfolio_warnings` | Failing builds, security alerts, low-health repos |
| `get_top_opportunities` | Repos ranked by opportunity score |
| `get_active_goals` | Goals with progress and deadlines |
| `get_coding_brief` | Session-start doc: health, in-flight PRs, attempt history, sessions |
| `get_next_action` | Top ROI task; skips open PRs + dead ends; includes confidence line |
| `log_session_complete` | Records what was accomplished |
| `get_active_work` | Open agent PRs per repo or portfolio-wide; safe-to-start flag |
| `log_attempt` | Records attempt outcome (success/failed/partial); feeds dead-end detection |
| `get_accuracy_report` | Advisor calibration table by action type + downgraded repos |

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
| Agent Execution | AI-Took-My-Job / Nexus (BullMQ + Render) |

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
- Deployments: every 12 hours
- AI summaries: Sundays
- Digest + Advisor + CEO Report: Mondays

### 7. (Optional) Connect Stripe

In Settings → Revenue Integration, add a restricted Stripe key with Subscriptions + Products read access.

### 8. (Optional) Enable MCP Server

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

RepoHQ integrates with **AI-Took-My-Job** (AI-DevOps Nexus) to automatically execute advisor recommendations. When you click "Run Agent" on an advisor action:

1. RepoHQ POSTs to Nexus `/internal/agent-tasks`
2. The Nexus worker clones the repo, creates an isolated branch
3. An AI agent (Claude Code) reads the RepoHQ coding brief via MCP and implements the action
4. Nexus runs validation (tests), promotes the PR
5. A webhook fires back to RepoHQ — notification + stage update + automatic health resync on merge
6. The advisor learning loop records the outcome for future accuracy tracking

**Lifecycle states:** `idle → queued → preparing → running → pr_ready → merged / failed / timed_out`

The Run Agent button hydrates from the database on mount — it always reflects the true current state even after navigation or page refresh. The server also blocks duplicate queuing server-side.

**Auto-dispatch (Phase 53):** Enable in Settings → Agent Auto-Dispatch. Every Monday the advisor automatically queues eligible actions — you wake up with PRs ready to review. Controls: effort gate (quick / quick+medium / all), max tasks per week (1–10), skip security tasks, minimum accuracy threshold. The server-side lifecycle guard ensures no repo gets double-queued.

To enable: add `NEXUS_API_URL`, `NEXUS_API_TOKEN`, and `NEXUS_WEBHOOK_SECRET` to your environment.

See [docs/agentic-full-flow.md](docs/agentic-full-flow.md) for architecture diagrams and mermaid sequence flows.

---

## gstack Integration

[gstack](https://garryslist.org) is a Claude Code skill framework providing specialised agent workflows (`/ship`, `/investigate`, `/qa`, etc.) with multi-turn planning and a learnings system.

### What's available now

The Nexus worker uses two shell script wrappers as `AGENT_EXECUTION_COMMAND`:

| Script | Task type | Behaviour |
|--------|-----------|-----------|
| `scripts/gstack-ship.sh` (Tier 2) | Dependency updates, CI fixes, documentation | Claude Code with structured output contract |
| `scripts/gstack-investigate.sh` (Tier 3) | Security fixes, complex investigations | Claude Code with diagnose-first, fix-only-if-safe rules |

Both scripts:
- Inject the RepoHQ coding brief (health, lifecycle, recent sessions, in-flight PRs) from `.nexus/context.json`
- Write `.nexus/output.json` in the Nexus agent output contract format
- Run in non-interactive (`--print`) mode via `npx claude`

These are **gstack-inspired wrappers** — named after gstack skill concepts, built on Claude Code CLI. They prove the execution pipeline works and produce real PRs today.

### What's coming

| Phase | Feature |
|-------|---------|
| **G1** | True gstack `/ship` and `/investigate` skill invocation (interactive, multi-turn planning) |
| **G2** | Task-type routing — security → `/investigate`, deps/docs/revenue → `/ship` |
| **G3** | gstack learnings persistence — agent operational discoveries accumulate across runs |
| **G4** | Checkpoint mode — WIP commits on every step; resume after crash without losing progress |
| **G5** | MCP + gstack synergy — `get_coding_brief` output auto-injected as gstack session context |
| **G6** | Dynamic `AGENT_EXECUTION_COMMAND` routing by `impactType` + `effort` in Nexus worker |

See the [gstack Integration Roadmap](docs/roadmap.md#gstack-integration-roadmap) for full details.

---

## Testing

```bash
npm test              # 467 Vitest unit tests
npm run test:e2e      # Playwright e2e tests (requires dev server)
npm run test:all      # both
npm run typecheck     # TypeScript strict check

# gstack integration tests (require ANTHROPIC_API_KEY, run from project root)
bash tests/integration/gstack-security-check.sh   # security investigation
bash tests/integration/gstack-health-check.sh     # code quality assessment
```

Unit tests cover: health scoring, opportunity scoring, archive scoring, valuation, portfolio score, simulation engine, opportunity cost, event computation, NL query filters, LLM adapter, nexus integration, notifications, MCP tools, advisor accuracy, agent lifecycle, provider mapping, auto-dispatch filter logic, cache TTL, Nexus output contract.

**gstack integration scripts** (`tests/integration/`) run gstack-style skill workflows against the RepoHQ codebase itself — using the same Claude Code patterns as agent executions. They validate the Nexus output.json contract and surface real security or health findings.

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

- [Architecture](docs/architecture.md) — system design, scoring formulas, DB schema, design decisions
- [Roadmap](docs/roadmap.md) — all phases shipped + upcoming, gstack roadmap, distribution roadmap
- [Architecture](docs/architecture.md) — risk tiers, safety gates, success metrics, competitive context
- [Agentic Full Flow](docs/agentic-full-flow.md) — mermaid architecture + sequence diagrams
- [MCP Setup](mcp/README.md) — IDE integration guide with all 11 tools
