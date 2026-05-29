# RepoHQ

**Live:** https://repohq.vercel.app

Personal GitHub portfolio health dashboard. Connect your GitHub account and get a single-pane-of-glass view of every repository — public and private — with health scores, security alerts, deployment status, and AI-generated summaries.

→ [Architecture](docs/architecture.md) · [Roadmap](docs/roadmap.md)

## Features

- **Portfolio Dashboard** — metric cards for total repos, healthy/at-risk/dead counts, security issues, average health
- **Repository Health Matrix** — sortable, filterable TanStack Table with column pinning and CSV export
- **Health Score Engine** — weighted formula: 20% activity · 20% security · 15% deployment · 15% docs · 10% testing · 10% dependency · 10% quality
- **Repository Intelligence** — auto-detects framework, language, database, hosting, CI/CD, and AI tools from `package.json`, Prisma schema, Docker Compose, and config files
- **Production Monitoring** — uptime checks with response time and SSL validation
- **Security Dashboard** — Dependabot alerts and secret scanning results grouped by severity
- **AI Repo Summaries** — Claude-powered summaries: what it does, maturity, risk, and next actions
- **Scheduled Sync** — Vercel Cron jobs keep everything up to date automatically
- **Dark mode** — system-aware theme with manual toggle

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
| Hosting | Vercel (Cron, Analytics) |

## Getting Started

### 1. Prerequisites

You need accounts at:
- [Neon](https://neon.tech) — PostgreSQL database
- [GitHub Developer Settings](https://github.com/settings/developers) — OAuth App
- [Anthropic Console](https://console.anthropic.com) — Claude API key (for AI summaries)

### 2. Clone and install

```bash
git clone https://github.com/smithdavedesign/Github-HQ.git
cd Github-HQ
npm install
```

### 3. Environment variables

Copy the example file and fill in your values:

```bash
cp .env.example .env.local
```

| Variable | How to get it |
|----------|--------------|
| `DATABASE_URL` | Neon project → Connection string |
| `GITHUB_CLIENT_ID` | GitHub → Settings → Developer settings → OAuth Apps → New OAuth App |
| `GITHUB_CLIENT_SECRET` | Same OAuth App → Generate a new client secret |
| `AUTH_SECRET` | Run `openssl rand -base64 32` |
| `ANTHROPIC_API_KEY` | Anthropic Console → API Keys |
| `CRON_SECRET` | Run `openssl rand -hex 32` |
| `NEXTAUTH_URL` | `http://localhost:3000` (dev) or your Vercel URL (prod) |

**GitHub OAuth App settings:**
- Homepage URL: `http://localhost:3000`
- Authorization callback URL: `http://localhost:3000/api/auth/callback/github`

### 4. Push database schema

```bash
DATABASE_URL=your_connection_string npx drizzle-kit push --config=drizzle.config.ts
```

### 5. Run locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), sign in with GitHub, then click **Sync** to import your repositories.

## Project Structure

```
src/
├── app/
│   ├── (app)/                 # Authenticated pages (shared layout)
│   │   ├── page.tsx           # Dashboard /
│   │   ├── repos/             # Repository table + detail
│   │   ├── security/          # Security findings
│   │   ├── deployments/       # Uptime monitoring
│   │   └── analytics/         # Health charts
│   ├── api/
│   │   ├── auth/              # Auth.js route handler
│   │   └── cron/              # Scheduled job endpoints
│   └── login/                 # Sign-in page
├── components/
│   ├── layout/                # Sidebar, Topbar, ThemeProvider
│   ├── dashboard/             # MetricCard, HealthTrendChart
│   └── repos/                 # RepoTable (TanStack), HealthBadge
├── lib/
│   ├── db/                    # Drizzle schema + connection
│   ├── github/                # Sync engine, scanner, security
│   ├── health/                # Health score formula
│   ├── monitoring/            # Uptime checker
│   ├── ai/                    # Claude API summaries
│   └── actions/               # Server actions
├── proxy.ts                   # Route protection (Next.js 16 middleware)
└── types/                     # TypeScript augmentations
```

## Database Schema

| Table | Purpose |
|-------|---------|
| `users` | Auth.js users + GitHub token |
| `accounts` | Auth.js OAuth accounts |
| `sessions` | Auth.js sessions |
| `repositories` | All synced GitHub repos |
| `repository_metrics` | Health, activity, security scores |
| `tech_stack` | Detected framework/db/hosting per repo |
| `deployments` | Production URLs + uptime status |
| `security_findings` | Dependabot + secret scanning alerts |
| `scans` | Sync job history and progress |

## Health Score Formula

```
Health Score (0–100) =
  Activity Score      × 20%
  Security Score      × 20%
  Deployment Score    × 15%
  Documentation Score × 15%
  Testing Score       × 10%
  Dependency Score    × 10%
  Quality Score       × 10%
```

| Score | Color | Label |
|-------|-------|-------|
| 90–100 | Green | Healthy |
| 70–89 | Yellow | At Risk |
| 0–69 | Red | Dead |

## Cron Schedule (Vercel)

| Job | Schedule | What it does |
|-----|----------|-------------|
| `/api/cron/sync` | Every 6 hours | Full GitHub repo sync |
| `/api/cron/security` | Every 24 hours | Dependabot + secret scanning |
| `/api/cron/deployments` | Every 12 hours | Uptime checks |
| `/api/cron/ai-summary` | Every Sunday 3am | Regenerate Claude summaries |

Cron routes require `Authorization: Bearer $CRON_SECRET` header.

## Deployment

### Vercel

1. Push to GitHub
2. Import the repo in Vercel
3. Set all environment variables from `.env.example`
4. Update `NEXTAUTH_URL` to your production domain
5. Update your GitHub OAuth App callback URL to `https://yourdomain.com/api/auth/callback/github`

Vercel will automatically pick up `vercel.json` and register the cron jobs.

## Roadmap

- [ ] Revenue tracking per project (MRR/ARR)
- [ ] Cost tracking (Vercel, OpenAI, Anthropic, AWS spend)
- [ ] Claude Code deep analysis per repo
- [ ] Opportunity scoring (which projects deserve attention?)
- [ ] Netlify and Render deployment integrations
- [ ] GitHub Actions workflow status
