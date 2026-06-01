# RepoHQ

**Live:** https://repohq.vercel.app

Personal GitHub portfolio health dashboard — a single-pane-of-glass view of every repository (public and private) with health scoring, AI analysis, revenue tracking, lifecycle management, and automated weekly intelligence reports.

→ [Architecture](docs/architecture.md) · [Roadmap](docs/roadmap.md)

---

## Features

**Dashboard**
- Portfolio metric cards: total repos, healthy/at-risk/dead, security issues, average health
- Portfolio P&L row: MRR, ARR, monthly cost, profit, margin
- **Portfolio Valuation** — estimated portfolio value (SaaS multiples for revenue repos, signal-based for non-revenue)
- **Lifecycle Distribution** — counts by stage: Idea / Building / Beta / Production / Growing / Maintaining / Sunsetting / Archived
- **Goals** — progress bars toward MRR, health, production, or custom targets; auto-updated each sync
- **AI Portfolio Advisor** — top 5 quantified actions (pre-computed opportunity score deltas, not guesses)
- **Weekly CEO Report** — portfolio summary, biggest wins, biggest risks, focus recommendations
- **Weekly AI Briefing** — top 3 portfolio priorities with urgency, reason, and concrete action
- **Archive Candidates** — repos with archive score ≥ 70; one-click transition to Sunsetting
- **Time Allocation** — "Best use of your next hours" — top 3 repos ranked by projected value delta
- **Opportunity Scoring** — "Needs Attention" and "Dormant but Promising" cards
- Top repositories table

**Repository Matrix**
- Sortable, filterable TanStack Table
- Columns: opportunity, health, activity, security, lifecycle, build status, tech debt, valuation, MRR, last push, framework, database, hosting, AI tools, tags
- **Natural language query** — `"repos not updated in 6 months"` or `"show my Next.js projects with security issues"`
- Saved views, global search, column visibility, CSV export

**Repository Detail**
- 13-week commit activity chart
- GitHub Actions build status
- **Lifecycle selector** — 8 stages from Idea to Archived
- **Purpose field** — why does this repo exist? (Revenue / Learning / Consulting / etc.)
- **Focus toggle** — star a repo to prioritise it in the CEO report and advisor
- Tags editor, per-repo re-sync, Claude Analyze button
- **Itemized costs** — line-item cost editor (Vercel: $20, domain: $15, etc.); total auto-summed
- Revenue tab — MRR, ARR, monthly cost, live profit and margin
- Analysis tab — architecture, security, code quality, tech debt, action plan
- Deployments tab — add/remove/check/auto-discover production URLs

**Portfolio Feed** (`/feed`)
- Health drops, down deployments, security alerts, dormant repos, failing builds
- Sorted by severity (critical → warning → info → positive)

**Security Dashboard**
- Dependabot alerts + secret scanning across all repos, grouped by severity

**Deployment Monitoring**
- Auto-discover from GitHub Environments + GitHub Pages
- Provider detection (Vercel, Netlify, Render, Railway, Fly, GitHub Pages, AWS, Azure)
- Uptime, response time, SSL validation

**Shareable Portfolio**
- `/u/[github-username]` — public portfolio (enable in Settings)
- `/u/[username]/resume` — print-friendly engineering portfolio
- `/u/[username]/report/2026-q2` — quarterly report with AI commentary
- Dynamic OG image for social sharing

**Settings**
- Goals manager, public portfolio toggle, sync history, cron schedule, OAuth scopes

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router, Turbopack) |
| Language | TypeScript |
| Styling | Tailwind CSS 4, shadcn/ui (Nova / Radix) |
| Table | TanStack Table v8 |
| Data fetching | TanStack Query v5 |
| Charts | Recharts |
| Database | PostgreSQL (Neon serverless) |
| ORM | Drizzle ORM |
| Auth | Auth.js v5 (GitHub OAuth) |
| AI | Anthropic Claude API (Sonnet 4.6 + Haiku 4.5) |
| Hosting | Vercel (Cron) |

---

## Getting Started

### Prerequisites
- [Neon](https://neon.tech) — PostgreSQL database
- [GitHub Developer Settings](https://github.com/settings/developers) — OAuth App
- [Anthropic Console](https://console.anthropic.com) — Claude API key

### Clone and install
```bash
git clone https://github.com/smithdavedesign/Github-HQ.git
cd Github-HQ
npm install
```

### Environment variables
```bash
cp .env.example .env.local
```

| Variable | How to get it |
|----------|--------------|
| `DATABASE_URL` | Neon project → Connection string |
| `GITHUB_CLIENT_ID` | GitHub → Settings → Developer settings → OAuth Apps |
| `GITHUB_CLIENT_SECRET` | Same OAuth App → Generate a new client secret |
| `AUTH_SECRET` | `openssl rand -base64 32` |
| `ANTHROPIC_API_KEY` | Anthropic Console → API Keys |
| `CRON_SECRET` | `openssl rand -hex 32` |
| `NEXTAUTH_URL` | `http://localhost:3000` (dev) or your Vercel URL (prod) |

**GitHub OAuth App:**
- Homepage URL: `http://localhost:3000`
- Callback URL: `http://localhost:3000/api/auth/callback/github`

### Push database schema
```bash
DATABASE_URL=your_connection_string npx drizzle-kit push --config=drizzle.config.ts
```

### Run locally
```bash
npm run dev
```

Open [localhost:3000](http://localhost:3000), sign in with GitHub, click **Sync**.

---

## Testing

```bash
npm test              # 142 Vitest unit tests
npm run test:e2e      # 38 Playwright e2e tests (requires dev server)
npm run test:all      # both
```

Unit tests cover: health scoring, opportunity scoring, archive scoring, valuation engine, NL query filters, scanner detection, uptime classification, date utilities.

E2e tests cover: auth flows, all pages, repos table, repo detail tabs.

---

## Deployment

1. Push to GitHub (public repo required for Vercel Hobby plan)
2. Import in Vercel, set all env vars from `.env.example`
3. Set `NEXTAUTH_URL` to your production domain
4. Update GitHub OAuth App callback to `https://yourdomain.com/api/auth/callback/github`

Vercel picks up `vercel.json` and registers cron jobs automatically.

**Cron schedule (Hobby plan — daily limit):**

| Job | Time (UTC) | Action |
|-----|-----------|--------|
| `/api/cron/sync` | 02:00 daily | Full GitHub sync + health snapshot + goal refresh |
| `/api/cron/security` | 03:00 daily | Dependabot + secret scanning |
| `/api/cron/deployments` | 04:00 daily | Uptime checks |
| `/api/cron/ai-summary` | 05:00 Sunday | Claude AI summaries |
| `/api/cron/digest` | 06:00 Monday | Digest + Advisor + CEO Report |

All cron routes require `Authorization: Bearer $CRON_SECRET`.

---

## Docs

- [Architecture](docs/architecture.md) — system design, scoring formulas, DB schema, design decisions
- [Roadmap](docs/roadmap.md) — shipped phases and what's next
