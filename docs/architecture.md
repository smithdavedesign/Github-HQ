# RepoHQ — Architecture

## Overview

RepoHQ is a Next.js 16 App Router application that synchronises GitHub repository data into a PostgreSQL database and surfaces it through a health-scoring dashboard.

```
┌─────────────┐    OAuth     ┌──────────────┐
│   Browser   │ ←──────────→ │   GitHub     │
└──────┬──────┘              └──────────────┘
       │ HTTPS                      │
       ▼                            │ REST API (Octokit)
┌─────────────────────────┐         │
│    Next.js 16 (Vercel)  │ ────────┘
│                         │
│  ┌─────────────────┐    │    ┌──────────────────┐
│  │  App Router     │    │    │  Neon PostgreSQL  │
│  │  Server Actions │ ───────→│  (Drizzle ORM)   │
│  │  Route Handlers │    │    └──────────────────┘
│  └─────────────────┘    │
│                         │    ┌──────────────────┐
│  ┌─────────────────┐    │    │  Anthropic Claude │
│  │  Vercel Cron    │ ───────→│  API             │
│  └─────────────────┘    │    └──────────────────┘
└─────────────────────────┘
```

## Request Flow

### Authentication
1. User visits `/login` → clicks "Continue with GitHub"
2. Auth.js v5 initiates GitHub OAuth with scopes: `repo read:user read:org security_events`
3. GitHub redirects to `/api/auth/callback/github`
4. Auth.js creates/updates user in `users` table via DrizzleAdapter
5. `events.signIn` stores the GitHub access token on the user record
6. Session created in `sessions` table; cookie set
7. `proxy.ts` (Next.js 16 middleware) guards all routes under `/repos`, `/security`, `/deployments`, `/analytics`

### Data Sync
1. User clicks **Sync** → calls `triggerSync()` server action
2. `syncAllRepos(userId)` fetches all repos via `octokit.paginate(repos.listForAuthenticatedUser)`
3. For each repo:
   - Upsert into `repositories`
   - Fetch commit activity, open PRs, issues, releases
   - Calculate `activity_score` and `activity_status`
   - Run `scanRepository()` — fetches `package.json`, `prisma/schema.prisma`, `docker-compose.yml`, `vercel.json`, `.github/workflows/` via GitHub Contents API
   - Upsert `tech_stack` and `documentation_score`
   - Calculate and upsert `repository_metrics` with full health score
4. `lastSyncedAt` timestamp updated on the user record

### Health Score Calculation
```
health_score =
  activity_score      × 0.20
  security_score      × 0.20
  deployment_score    × 0.15
  documentation_score × 0.15
  testing_score       × 0.10
  dependency_score    × 0.10
  quality_score       × 0.10
```

Sub-scores are pure functions in `src/lib/health/scoring.ts`.

### Scheduled Jobs
Vercel Cron calls each endpoint daily with `Authorization: Bearer $CRON_SECRET`:

| Endpoint | Time | Action |
|----------|------|--------|
| `/api/cron/sync` | 02:00 UTC | Full GitHub sync for all users |
| `/api/cron/security` | 03:00 UTC | Dependabot + secret scanning |
| `/api/cron/deployments` | 04:00 UTC | Uptime checks for all deployment URLs |
| `/api/cron/ai-summary` | 05:00 UTC Sunday | Claude summaries for all repos |

## File Structure

```
src/
├── app/
│   ├── (app)/              # Route group — authenticated pages + shared layout
│   │   ├── layout.tsx      # Auth check, sidebar, topbar
│   │   ├── page.tsx        # Dashboard /
│   │   ├── repos/          # /repos + /repos/[id]
│   │   ├── security/       # /security
│   │   ├── deployments/    # /deployments
│   │   └── analytics/      # /analytics
│   ├── api/
│   │   ├── auth/           # Auth.js handler
│   │   └── cron/           # sync | security | deployments | ai-summary
│   └── login/
├── components/
│   ├── layout/             # Sidebar, Topbar, QueryProvider, ThemeProvider
│   ├── dashboard/          # MetricCard, HealthTrendChart
│   └── repos/              # RepoTable (TanStack Table), HealthBadge
├── lib/
│   ├── db/                 # Drizzle schema + Neon connection
│   ├── github/             # client.ts, sync.ts, scanner.ts, security.ts
│   ├── health/             # scoring.ts — pure health score formula
│   ├── monitoring/         # uptime.ts — fetch-based URL checker
│   ├── ai/                 # summary.ts — Claude API integration
│   └── actions/            # Server actions: sync, repositories, deployments
└── proxy.ts                # Route protection (Next.js 16 middleware)
```

## Database Schema

```
users               id (PK), github_token, last_synced_at
  └── accounts      (provider, provider_account_id) composite PK
  └── sessions      session_token (PK), expires
  └── repositories  id (PK), github_id, user_id (FK)
        └── repository_metrics   repo_id (unique FK), health/activity/security scores
        └── tech_stack           repo_id (unique FK), detected stack
        └── deployments          repo_id (FK), url, status, ssl_valid
        └── security_findings    repo_id (FK), severity, type, state
  └── scans         id (PK), user_id (FK), type, status, progress
```

## Key Design Decisions

**Neon HTTP driver** — uses `drizzle-orm/neon-http` for serverless-safe queries without persistent connections. Works in Vercel's function environment without connection pooling overhead.

**Lateral joins for related data** — Drizzle's `findMany` with `with:` generates PostgreSQL lateral joins. Sorting by metrics columns must happen in JavaScript post-fetch since the lateral-joined table isn't in scope for `ORDER BY`.

**No transactions** — the neon-http driver doesn't support transactions. All operations are individual upserts with `onConflictDoUpdate`, making them safe to re-run.

**`proxy.ts` not `middleware.ts`** — Next.js 16 renamed middleware to "proxy". The file must export `proxy` (named) or a default export, not `middleware`.

**Async request APIs** — Next.js 16 removed synchronous access to `cookies()`, `headers()`, `params`, and `searchParams`. All must be `await`ed.

**Fire-and-forget sync** — `triggerSync()` server action starts the sync without awaiting, returning immediately to the client. Progress is tracked via the `scans` table and can be polled.
