# RepoHQ

**Personal GitHub portfolio intelligence dashboard** — health scoring, AI analysis, revenue tracking, lifecycle management, automated weekly intelligence, and an AI agent execution pipeline for every repo you own.

**Live:** https://repohq.vercel.app · **[System overview: start here](docs/system-overview.md)** · [Architecture](docs/architecture.md) · [Roadmap](docs/roadmap.md)

RepoHQ is one part of a larger system whose goal is **products people use and pay for, with near-zero overhead for the owner and no financial risk**: a local AI stack with context on every repo, a research center, an idea pipeline that reviews and demand-tests ideas before building them, and a factory that keeps everything healthy. The [system overview](docs/system-overview.md) has the map, the rules and the scorecard.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fsmithdavedesign%2FGithub-HQ&env=DATABASE_URL,GITHUB_CLIENT_ID,GITHUB_CLIENT_SECRET,AUTH_SECRET,ANTHROPIC_API_KEY,CRON_SECRET,NEXTAUTH_URL&envDescription=See%20README%20for%20setup%20instructions&project-name=repohq&repository-name=repohq)

---

## What it does

RepoHQ syncs all your GitHub repos (public + private) and gives you a unified view of your entire portfolio — then acts on it automatically:

- **Health score** — 7-factor weighted score per repo (activity, security, deployments, docs, tests, dependencies, quality)
- **Opportunity score** — revenue potential × activity × health × stars; surfaces what to work on next
- **Portfolio Score** — single 0–100 grade for your whole portfolio with weekly delta
- **AI Advisor** — top 5 quantified actions with exact score deltas and confidence ratings based on past accuracy
- **gstack Skill Launcher** — 8 skills across 5 lifecycle phases launched from the repo Agent tab or via MCP
- **Agent Execution** — queue any advisor action or gstack skill; the factory (`factory/`), the only thing that writes code, runs it sandboxed on free models and judges every change
- **Advisor Learning Loop** — the advisor tracks predicted vs actual outcomes and improves recommendations over time
- **Auto-Dispatch** — Monday cron queues eligible advisor actions for the factory
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
- **Agent tab** — gstack skill launcher (8 skills, 5 phases) + AI advisor actions (expandable, Run Agent button) + agent history (tasks queued, PR status + links, skill reports with inline findings preview, predicted vs actual delta)
- 13-week commit chart, lifecycle + purpose + effort selectors, focus toggle, tags

**gstack Skill Launcher**
- 8 skills grouped by lifecycle phase, launched from the repo Agent tab or `queue_gstack_skill` MCP tool; enabled for repos on the factory allowlist
- Each skill has an editable objective field and live status badges (Queued → Running → Report ready / PR Ready / Verified / Failed)
- Inline findings preview shown when a report skill completes — links to full report in Agent History
- Last-run history shown for each skill when idle (days ago + finding count)
- `/canary` is listed but unavailable: checking a live app needs a browser and network access the factory sandbox doesn't have

| Phase | Skills (fix = one judged draft PR, report = findings, no changes) |
|-------|--------|
| Understand | `/investigate` (root cause, report), `/review` (code review, report) |
| Build Quality | `/qa-only` (find bugs, report), `/qa` (find + fix bugs, fix) |
| Ship | `/ship` (implement, fix), `/document-release` (update docs + CHANGELOG, fix) |
| Monitor | `/health` (code quality score, report), `/canary` (unavailable) |
| Reflect | `/retro` (weekly commit analysis, report) |

**Agent Execution Pipeline**
- "Run Agent" on any advisor action or gstack skill → an `agent_requests` row in Neon plus a BullMQ job; the factory worker takes it next (requests go ahead of scheduled cycles)
- The skill picks the mode: fix skills become one judged draft PR, report skills a read-only investigation with findings
- Report outcomes (`agent_skill_report` events) store findings; UI shows inline preview
- Lifecycle guard — prevents duplicate queuing; button hydrates from DB on mount so stage is always accurate
- Status stages: Queued → Running → PR Ready / Verified / Report Ready → Merged / Failed
- Agent history, attempt log, skill report findings, and PR links on repo detail Agent tab

**Agent Observability**
- **Agents** (`/agent-performance`) — the factory worker (online, paused, on AC, Docker), queue counts, schedules and recent runs (factory jobs and crons on one timeline), every request with its step-by-step trace, and owner controls (run now, pause/resume, cancel, retry); then factory KPIs and the advisor accuracy table
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
- **The factory** (`factory/`) — the only agent executor; see [Agentic Execution](#agentic-execution-the-factory) below
- **gstack** — skill names and lifecycle phases for the launcher; the factory maps each skill to a fix or report task
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
| `queue_gstack_skill` | Queue one of the 8 skills for the factory on an allowlisted repo; returns taskId |
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
| Agent Execution | The factory: BullMQ on Redis (Render Key Value) + a worker on the owner's Mac (Docker sandbox, LiteLLM/Ollama) |

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

### 8. (Optional) Run the factory

The factory runs on your own machine (it needs Docker and a local model gateway). Set it up with
[factory/README.md](factory/README.md), then add to Vercel and `.env.local`:

```bash
REDIS_URL=rediss://...        # the agent-hq-redis Key Value from render.yaml
FACTORY_USER_ID=your-user-id  # the same id as in ~/.repohq-factory/env
```

The gstack Skill Launcher and Run Agent buttons activate for repos on the factory allowlist
(`factory/factory.config.json`). Without `FACTORY_USER_ID` they show why they are off. Without
`REDIS_URL`, requests still queue in Neon and the worker picks them up at its next cycle.

### Advisor Dispatch Skill Policy

- Advisor-dispatched autonomous tasks default to gstack skills:
  - `security` impact → `/investigate`
  - `health` / `opportunity` / `revenue` impact → `/ship`
- Optional per-repo allowlist via repository tag:
  - `gstack-allow:ship,investigate`
  - `gstack-allow:all` (or omit tag) allows default behavior.
- Optional global override via env JSON map:

```bash
REPO_GSTACK_SKILL_ALLOWLIST_JSON={"owner/repo":["ship","investigate"]}
```

Env override takes precedence over repo tags.

### Auto-Run Skill Tier Policy

Auto-dispatch now applies tiered safety rules before queueing advisor actions:

- `report-only`: always allowed except archived repos.
- `analyze+fix`: allowed for lifecycle stages `building`, `beta`, `production`, `growing`, `maintaining`; requires at least medium confidence.
- `high-risk`: allowed for `beta`, `production`, `growing`, `maintaining`; requires high confidence.

Confidence is derived from per-impact historical accuracy signal (`successRate` + minimum data points).

### Progressive Autonomy Controls

- Low-risk tiers (`report-only`, `analyze+fix`) auto-run by default once lifecycle + confidence gates pass.
- High-risk tier requires explicit per-repo opt-in for auto-dispatch:
  - Repo tag: `gstack-optin:high-risk`
  - Optional env override map: `REPO_GSTACK_HIGH_RISK_OPT_IN_JSON={"owner/repo":true}`
- Env override map takes precedence over tags.

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

## Agentic Execution (the factory)

> **The core thesis:** RepoHQ has Find, Prioritize, and Measure. The factory adds Execute — the loop closing.

The factory (`factory/`) is the only thing that writes code ([PRD](docs/agent-hq-migration-prd.md), roadmap Phase 81). It replaced the AI-Took-My-Job (Nexus) executor. When you click "Run Agent" or launch a skill:

1. RepoHQ checks the repo is on the factory allowlist and has no request or agent PR in flight, then writes an `agent_requests` row (`queued`) and an `agent_task_queued` event, and adds a BullMQ job to the `factory` queue on Redis
2. The factory worker (`factory/worker.ts`, under launchd on the owner's Mac) claims the row and runs one cycle for that repo: clone, sandboxed install and checks, the model ladder (free models first), Judge v2 and an adversarial review
3. The outcome lands back on the row and as events: `agent_pr_created` (fix skills, a draft PR once `owner-requested` is promoted to `pr`), `verified` (judged and held at stage `report`), `agent_skill_report` (report skills, with findings), or `agent_execution_failed`
4. The Agents page shows the request, its step-by-step trace and the worker's state; the Run Agent button polls `/api/agent-task-status?taskId=...`

**Request states:** `queued → running → pr | verified | reported | rejected | failed`, or `cancelled` while queued. A request waiting for the Mac (asleep, on battery, Docker down) stays `queued`, with the reason when the worker deferred it; nothing is re-routed to a paid model.

**Auto-dispatch:** Enable in Settings → Agent Auto-Dispatch. Every Monday the advisor queues eligible actions for the factory. Controls: effort gate (quick / quick+medium / all), max tasks per week (1–10), skip security tasks, minimum accuracy threshold.

**No auto-chaining and no CI-fix loop:** the factory runs the repo's checks before it opens a PR. A PR that still fails CI is flagged `needs human` with a notification; you decide what runs next. Like any open agent PR, it blocks new requests on its repo until it's merged or closed.

Neon is the source of truth and Redis only wakes the worker: a lost job is re-queued from the row. See [docs/autonomous-factory.md](docs/autonomous-factory.md) for the factory design and [factory/README.md](factory/README.md) for the operator guide. What the move off Nexus's Render workers costs (above all: requests wait for the Mac, and run on free models), and what to do about it, is in [docs/agent-hq-tradeoffs.md](docs/agent-hq-tradeoffs.md).

---

## gstack Integration

[gstack](https://garryslist.org) is a Claude Code skill framework providing specialised agent workflows (`/ship`, `/investigate`, `/qa`, etc.). RepoHQ keeps its skill names and lifecycle phases; the factory runs each skill as a fix or report task with its own guidance (`factory/lib/tasks.ts`). G1–G6 (Claude Code CLI with gstack scripts, learnings, checkpoint mode, the brief in `CLAUDE.md`, the skill router) ran in the Nexus worker and retired with it.

The scripts in `tests/integration/` are manual checks that run a skill-style prompt against this codebase with the Claude Code CLI (paid, outside the factory). Run from the project root:

```bash
bash tests/integration/gstack-security-check.sh    # /investigate — security
bash tests/integration/gstack-health-check.sh      # /health — code quality
bash tests/integration/gstack-review-check.sh      # /review — code review
bash tests/integration/gstack-qa-only-check.sh     # /qa-only — bug hunt
bash tests/integration/gstack-retro-check.sh       # /retro — weekly analysis
```

See the [gstack Integration Roadmap](docs/roadmap-history.md#gstack-integration-roadmap) for the history.

---

## Testing

```bash
npm test              # Vitest unit tests (1,100+ tests, 68 files)
npm run test:e2e      # Playwright e2e on a throwaway Neon branch (needs the Neon CLI logged in)
npm run test:all      # both
npm run typecheck     # TypeScript strict check

docker compose --profile flow up -d   # throwaway Postgres + Redis for the flow tests
npm run test:flow                     # the Agent HQ flow end to end: app → queue → real worker → Neon
npm run test:flow:e2e                 # the same in the browser (next dev + the worker)
```

The flow tests ([tests/flow](tests/flow/README.md)) validate the one-agent-system migration with nothing mocked but the session and the job itself: the factory migration lands on the `db:push` schema, Run agent writes the request and its BullMQ job, the real worker claims, gates, runs, defers, retries and resolves it, and the status API and the Agents page show the outcome and its trace. They run on a disposable database (never `.env.local`'s) and in CI on every pull request.

Unit tests cover: health scoring, opportunity scoring, archive scoring, valuation, portfolio score, simulation engine, opportunity cost, event computation, NL query filters, LLM adapter, notifications, MCP tools, advisor accuracy, agent lifecycle, provider mapping, auto-dispatch filter logic, cache TTL, security fixes, gstack skill policy, skill report logic, factory queue access, the factory worker and its policies, the Agents page, and more.

Integration scripts (`tests/integration/`) run gstack-style skill prompts against the RepoHQ codebase via Claude Code CLI and check the JSON report shape they ask for (`nexus-agent-output-v1`, kept from the Nexus era).

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
- [Audit (2026-10)](docs/audit-2026-10.md) — whole-system audit: live site, security, architecture, roadmap triage
- [One agent system PRD](docs/agent-hq-migration-prd.md) — the factory as the only executor, the queue and worker, the Agents page, the cutover runbook
- [Trade-offs of leaving the Render workers](docs/agent-hq-tradeoffs.md) — what moving execution to the Mac costs (availability, model quality, ops, PR identity) and buys, the trial-week scorecard, and what to do next
- [Agentic Full Flow](docs/agentic-full-flow.md) / [Execution Flow](docs/agentic-execution-flow.md) — the Nexus-era pipeline (superseded by the PRD; kept for history)
- [AI stack](docs/ai-stack/README.md) — the local AI platform the factory runs on: Ollama, Headroom, LiteLLM and its free-model pool, the coding agents, the OpenClaw companion; architecture, runbook, reference, roadmap (moved here from the `ai-stack-docs` repo)
- [Autonomous Factory](docs/autonomous-factory.md) — free-model-first self-improvement loop: local AI stack lane, model-tier routing, Docker-sandboxed worker, Judge v2 + adversarial review, capability stages, sensors and a ranked queue, job record and KPIs, night shift, infra agent (Horizon 3). Operator guide: [factory/README.md](factory/README.md)
- [System overview](docs/system-overview.md) — **start here**: the goal, the loop (research → gstack review → $0 demand test → build → revenue), where every part lives, the rules (money, models, data classes, human merges), how agents get context, the scorecard and the schedules
- [System logging](docs/logging.md) — one log across every system (RepoHQ, factory, idea pipeline, AI stack, OpenClaw, launchd, GitHub crons), probes, and Slack #team-agents alerts for failures and recoveries
- [Idea factory](docs/idea-factory.md) — the daily idea pipeline: research on the local stack → Notion Idea Board → the owner picks Build or Pass → private repo; how the factory will pick up idea repos after the 30-day window
- [Personal context policy](docs/personal-context.md) — data classes (public, personal, work-confidential, financial), what each consumer (companion, scout, factory, Resource Center) may read and which models each class may reach, and what enforces it
- [gstack Findings](docs/gstack-findings.md) — running log of skill run findings and resolutions
- [MCP Setup](mcp/README.md) — IDE integration guide with all 14 tools
