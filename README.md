# RepoHQ

**Personal GitHub portfolio intelligence dashboard** — health scoring, AI analysis, revenue tracking, lifecycle management, and automated weekly intelligence for every repo you own.

**Live:** https://repohq.vercel.app · [Architecture](docs/architecture.md) · [Roadmap](docs/roadmap.md)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fsmithdavedesign%2FGithub-HQ&env=DATABASE_URL,GITHUB_CLIENT_ID,GITHUB_CLIENT_SECRET,AUTH_SECRET,ANTHROPIC_API_KEY,CRON_SECRET,NEXTAUTH_URL&envDescription=See%20README%20for%20setup%20instructions&project-name=repohq&repository-name=repohq)

---

## What it does

RepoHQ syncs all your GitHub repos (public + private) and gives you a unified view of your entire portfolio:

- **Health score** — 7-factor weighted score per repo (activity, security, deployments, docs, tests, dependencies, quality)
- **Opportunity score** — revenue potential × activity × health × stars; surfaces what to work on next
- **Portfolio Score** — single 0–100 grade for your whole portfolio with weekly delta
- **AI Advisor** — top 5 quantified actions with exact score deltas (not vague suggestions)
- **Simulation Engine** — "given 10h this week and a goal of max ARR, here's the optimal allocation"
- **Revenue tracking** — MRR, ARR, costs, P&L per repo; Stripe auto-sync
- **Lifecycle management** — 8 stages from Idea to Archived with abandonment tracking
- **Triage mode** — bulk-review every repo with keyboard shortcuts to keep/sunset/archive/skip
- **MCP Server** — exposes portfolio context to Claude Code and MCP-compatible IDE tools

---

## Features

**Dashboard**
- Portfolio Score card — circular gauge, A–F grade, component bars, weekly delta
- Portfolio Risk — revenue concentration, single-failure detection, stack exposure
- Weekly Diff — top health mover, new repos, MRR changes, new security alerts
- Plan My Week — simulation engine; greedy ROI-per-hour allocation given your available hours
- Opportunity Cost — what you worked on vs what had the highest value this week
- GitHub Profile Optimizer — top 6 repos to pin on your GitHub profile
- Portfolio Valuation — SaaS multiples for revenue repos, signal-based for non-revenue
- AI Portfolio Advisor, CEO Report, Weekly Briefing, Goals, Time Allocation, Archive Candidates
- Lifecycle Distribution, Opportunity Scoring ("Needs Attention" / "Dormant but Promising")

**Repository Matrix**
- TanStack Table — sortable, filterable, column visibility, saved views, CSV export
- Natural language query — `"repos not updated in 6 months with security issues"`
- Columns: health, opportunity, valuation, MRR, security, lifecycle, build status, tech debt, framework, database, hosting, AI tools, tags

**Repository Detail**
- 13-week commit chart, lifecycle + purpose + effort selectors, focus toggle, tags
- Revenue tab — MRR, ARR, itemized costs, profit, margin
- Analysis tab — Claude architecture review, tech debt level, action plan
- Deployments tab — add/remove/check/auto-discover from GitHub Environments + Pages

**Portfolio Feed** — health drops, deployments, security alerts, dependency cascade risk
  - Milestones tab — personal changelog with auto-captured events + manual entries
  - Annual markdown export

**Portfolio Intelligence**
- Triage mode (`/repos/triage`) — keyboard-driven bulk lifecycle decisions
- Idea Graveyard — archived repos with abandonment reasons; advisor warns when new actions resemble graveyard ideas
- Concentration Risk — revenue and stack exposure analysis
- Dependency Map — internal npm dependency graph on Analytics page
- Profile Optimizer — showcase score for public repos

**Integrations**
- **Stripe** — restricted API key; maps products to repos; MRR auto-syncs daily
- **MCP Server** (`mcp/server.ts`) — 5 tools for Claude Code: portfolio summary, repo context, warnings, top opportunities, goals
- GitHub Environments + Pages auto-discovery for deployments

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
| AI | Anthropic Claude API (Sonnet 4.6 + Haiku 4.5) |
| Hosting | Vercel |
| Crons | GitHub Actions (primary) + Vercel weekly fallback |
| Revenue | Stripe REST API (restricted key, no SDK) |
| IDE | MCP Server (stdio, `@modelcontextprotocol/sdk`) |

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

For local development, create a **second** OAuth App with:
- Homepage URL: `http://localhost:3000`
- Callback URL: `http://localhost:3000/api/auth/callback/github`

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
DATABASE_URL=your_url npx drizzle-kit push
npm run dev
```

Open [localhost:3000](http://localhost:3000), sign in with GitHub, click **Sync**.

### 5. Deploy to Vercel

```bash
# Or use the Deploy button at the top of this README
vercel --prod
```

Set all env vars in Vercel → Project → Settings → Environment Variables. Set `NEXTAUTH_URL` to your production URL and update the GitHub OAuth App callback.

### 6. Set up GitHub Actions crons

Add `CRON_SECRET` to your GitHub repo → Settings → Secrets → Actions. The workflows in `.github/workflows/` will trigger automatically:
- Sync: every 6 hours
- Security: daily
- Deployments: every 12 hours
- AI summaries: Sundays
- Digest + Advisor + CEO Report: Mondays

### 7. (Optional) Connect Stripe

In Settings → Revenue Integration, add a restricted Stripe key with Subscriptions + Products read access. Map products to repos for automatic MRR sync.

### 8. (Optional) Enable MCP Server for Claude Code

```bash
# Add to ~/.claude/claude.json
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

See [mcp/README.md](mcp/README.md) for full setup. Your user ID is in the `users` table.

---

## Testing

```bash
npm test              # 181 Vitest unit tests
npm run test:e2e      # 38 Playwright e2e tests (requires dev server)
npm run test:all      # both
```

Unit tests cover: health scoring, opportunity scoring, archive scoring, valuation, portfolio score, showcase scoring, simulation engine, opportunity cost, event computation, dependency cross-reference, NL query filters, scanner detection, uptime classification, date utilities.

---

## Docs

- [Architecture](docs/architecture.md) — system design, scoring formulas, DB schema, design decisions
- [Roadmap](docs/roadmap.md) — all 42 phases, what's shipped, what's next
- [MCP Setup](mcp/README.md) — IDE integration guide
