# RepoHQ

**Live:** https://repohq.vercel.app

Personal GitHub portfolio health dashboard. Connect your GitHub account and get a single-pane-of-glass view of every repository — public and private — with health scores, lifecycle tracking, opportunity scoring, security alerts, deployment monitoring, revenue tracking, and AI-powered analysis.

→ [Architecture](docs/architecture.md) · [Roadmap](docs/roadmap.md)

---

## Features

**Dashboard**
- Portfolio overview with metric cards: total repos, healthy/at-risk/dead counts, security issues, average health score
- Portfolio P&L row: MRR, ARR, monthly cost, profit and margin (when revenue data is set)
- **Lifecycle Distribution** — counts by stage: Idea / Building / Beta / Production / Growing / Maintaining / Sunsetting / Archived
- **Opportunity scoring** cards: "Needs Attention" (high opportunity + poor health) and "Dormant but Promising" (high opportunity + low activity)
- **Weekly AI Briefing** — top 3 portfolio priorities from Claude, regenerated every Monday
- Top repositories table with health scores and tech stack

**Repository Health Matrix**
- Sortable, filterable TanStack Table across all repos
- Columns: opportunity score, health, activity, security, build status, lifecycle, tech debt, last push, production URL, issues, PRs, framework, database, hosting, AI tools, MRR, revenue flag, tags
- Global search, column visibility toggle, CSV export
- Saved views — persist column layout and sort order to localStorage
- **Natural language query** — ask in plain English: *"repos not updated in 6 months"* or *"show my Next.js projects with security issues"*

**Health Score Engine**
- Weighted formula: 20% activity · 20% security · 15% deployment · 15% docs · 10% testing · 10% dependency · 10% quality
- Color coded: green ≥ 90, yellow 70–89, red < 70

**Repository Intelligence**
- Auto-detects framework, language, database, hosting, CI/CD, analytics, and AI tools from `package.json`, Prisma schema, Docker Compose, and config files

**Repository Detail**
- 13-week commit activity chart
- GitHub Actions build status
- **Lifecycle selector** — set stage (Idea → Production → Archived) per repo
- Tags editor — add/remove chip tags
- Revenue tab — set MRR, ARR, monthly cost; see live profit and margin

**Portfolio Feed**
- Chronological activity feed at `/feed` — health drops, down deployments, security alerts, dormant repos, build failures
- Sorted by severity: critical → warning → info → positive
- Every event links directly to the relevant repo

**Claude Analysis** *(Phase 5)*
- Per-repo deep analysis: architecture pattern, security rating, code quality rating, tech debt level
- Prioritised action plan (High/Medium/Low) with rationale
- Overall Claude score 0–100, stored in DB and shown in Analysis tab

**Security Dashboard**
- Dependabot alerts and secret scanning results across all repos
- Grouped by severity: critical, high, medium, low

**Deployment Monitoring** *(Phase 6)*
- Auto-discover URLs from GitHub Environments and GitHub Pages
- Manual URL entry with provider auto-detection (Vercel, Netlify, Render, Railway, Fly, GitHub Pages, AWS, Azure)
- Per-URL uptime check: response time, HTTP status, SSL validation
- Add/remove/check individual deployment URLs from repo detail page

**Sync**
- Full GitHub sync (public + private repos) with real-time progress bar
- Per-repo manual re-sync button
- Rate limit guard — backs off when GitHub API limit is running low
- Vercel Cron jobs keep data fresh automatically

**Shareable Portfolio View**
- Public URL at `/u/[github-username]` — no auth required
- Enable in Settings → Portfolio toggle
- Shows public repos with health badges, tech stack, AI summary, deployment dots

**Settings**
- GitHub OAuth scopes overview
- Sync history with repo counts
- Cron schedule reference
- Public portfolio toggle

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
| AI | Anthropic Claude API (`claude-sonnet-4-6`) |
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
npm test              # 54 Vitest unit tests
npm run test:e2e      # 38 Playwright e2e tests (requires dev server)
npm run test:all      # both
```

Unit tests cover: health scoring formula, repository intelligence scanner, uptime classification, date utilities.

E2e tests cover: auth flows, all pages, repos table interactions, repo detail tabs.

---

## Deployment

1. Push to GitHub (repo must be public for Vercel Hobby plan)
2. Import in Vercel, set all env vars from `.env.example`
3. Set `NEXTAUTH_URL` to your production domain
4. Update GitHub OAuth App callback to `https://yourdomain.com/api/auth/callback/github`

Vercel picks up `vercel.json` automatically and registers cron jobs.

**Cron schedule (Vercel Hobby — daily limit):**

| Job | Time (UTC) | Action |
|-----|-----------|--------|
| `/api/cron/sync` | 02:00 daily | Full GitHub repo sync |
| `/api/cron/security` | 03:00 daily | Dependabot + secret scanning |
| `/api/cron/deployments` | 04:00 daily | Uptime checks |
| `/api/cron/ai-summary` | 05:00 Sunday | Claude AI summaries |

All cron routes require `Authorization: Bearer $CRON_SECRET`.

---

## Docs

- [Architecture](docs/architecture.md) — system design, data flow, key decisions
- [Roadmap](docs/roadmap.md) — shipped phases and what's next
