# RepoHQ — Architecture

## System Overview

RepoHQ is a Next.js 16 App Router application. It syncs GitHub repository data into Neon PostgreSQL and surfaces it as a health-scoring dashboard with AI analysis and deployment monitoring.

```
┌─────────────┐    OAuth     ┌──────────────────────┐
│   Browser   │ ←──────────→ │   GitHub             │
└──────┬──────┘              │   REST API (Octokit) │
       │ HTTPS               └──────────┬───────────┘
       ▼                                │
┌──────────────────────────────────────┐│
│   Next.js 16 on Vercel               ││
│                                      ││
│  App Router     ←── Server Actions ──┤│
│  Route Handlers ←── Vercel Cron   ───┘│
│  proxy.ts       (auth guard)          │
│                                       │
│         ┌────────────────┐            │
│         │  Neon Postgres │            │
│         │  (Drizzle ORM) │            │
│         └────────────────┘            │
│                                       │
│         ┌────────────────┐            │
│         │ Anthropic API  │            │
│         │ (Claude)       │            │
│         └────────────────┘            │
└───────────────────────────────────────┘
```

---

## Key Flows

### Authentication
1. User visits `/login` → clicks "Continue with GitHub"
2. Auth.js v5 initiates GitHub OAuth (`repo read:user read:org security_events` scopes)
3. Callback hits `/api/auth/callback/github`
4. DrizzleAdapter creates/updates `users` row; session written to `sessions` table
5. `events.signIn` stores the GitHub access token on the user record for API calls
6. `proxy.ts` (Next.js 16 middleware, formerly `middleware.ts`) guards all authenticated routes

### Sync
1. User clicks **Sync** → `triggerSync()` server action called
2. `after()` from `next/server` defers `syncAllRepos()` — response returns immediately, Vercel's `waitUntil` keeps the function alive
3. Sync creates a `scans` row (`status: running`) and increments `processed_repos` after each repo
4. Client polls `/api/sync-status` every 3s via TanStack Query; progress bar renders live
5. For each repo, sync fetches:
   - Commit activity stats (13 weeks)
   - Open PRs, issues, releases
   - Latest GitHub Actions workflow run (build status)
   - `package.json`, Prisma schema, Docker Compose, config files (repository intelligence)
   - `README.md` for documentation score
6. Rate limit guard checks `X-RateLimit-Remaining`; slows at < 300, pauses at < 100
7. On completion, `revalidatePath('/', 'layout')` busts the Next.js page cache

### Claude Analysis
1. User clicks **Analyze with Claude** on a repo detail page
2. `analyzeRepo()` server action called → returns immediately
3. `after()` runs `analyzeRepository(repoId)` in the background
4. Claude receives: name, description, tech stack, activity metrics, security findings, deployments, revenue data
5. System prompt is cached (ephemeral) across calls for cost efficiency
6. Response is parsed from JSON and stored in `repositories.claude_analysis` (jsonb)
7. `revalidatePath` invalidates the detail page; next visit shows the Analysis tab

### Deployment Discovery
1. User clicks **Auto-discover** on the Deployments tab
2. `discoverRepoDeployments()` fetches GitHub Environments and GitHub Pages via Octokit
3. Each environment's latest deployment status URL is extracted
4. Provider is inferred from the URL pattern (Vercel, Netlify, Render, etc.)
5. Repo homepage URL is also checked if set
6. New URLs are inserted into `deployments` and immediately uptime-checked

### Health Score
```
health_score =
  activity_score      × 0.20   (commits, PRs, releases in last 90 days)
  security_score      × 0.20   (100 − penalty per Dependabot/secret alert)
  deployment_score    × 0.15   (based on uptime status of configured URLs)
  documentation_score × 0.15   (README quality: installation, env, screenshots, etc.)
  testing_score       × 0.10   (detected test framework in package.json)
  dependency_score    × 0.10   (days since last push)
  quality_score       × 0.10   (default 70; future: GitHub code scanning)
```

Pure function in `src/lib/health/scoring.ts`. Recalculated on every sync and security scan.

### Scheduled Jobs
Vercel Cron hits each endpoint daily (`Authorization: Bearer $CRON_SECRET`):

| Endpoint | Time (UTC) | What it does |
|----------|-----------|-------------|
| `/api/cron/sync` | 02:00 | Full GitHub sync for all users |
| `/api/cron/security` | 03:00 | Dependabot + secret scanning, recalculates health |
| `/api/cron/deployments` | 04:00 | Uptime check for all deployment URLs |
| `/api/cron/ai-summary` | 05:00 Sun | Regenerates Claude AI summaries for all repos |

---

## File Structure

```
src/
├── app/
│   ├── (app)/                    # Route group — shared authenticated layout
│   │   ├── layout.tsx            # Auth check, Sidebar, Topbar
│   │   ├── page.tsx              # Dashboard with P&L row
│   │   ├── repos/
│   │   │   ├── page.tsx          # Repos table (TanStack)
│   │   │   └── [id]/page.tsx     # Repo detail with tabs
│   │   ├── security/page.tsx
│   │   ├── deployments/page.tsx
│   │   ├── analytics/page.tsx
│   │   └── settings/page.tsx
│   ├── api/
│   │   ├── auth/[...nextauth]/   # Auth.js route handler
│   │   ├── sync-status/          # Polled by TanStack Query for progress bar
│   │   └── cron/                 # sync | security | deployments | ai-summary
│   └── login/page.tsx
├── components/
│   ├── layout/
│   │   ├── sidebar.tsx
│   │   ├── topbar.tsx            # Sync button, progress bar, theme toggle
│   │   ├── sync-progress.tsx     # TanStack Query polling component
│   │   ├── query-provider.tsx
│   │   └── theme-provider.tsx    # useTheme hook + CSS class toggle
│   ├── dashboard/
│   │   ├── metric-card.tsx
│   │   └── health-trend-chart.tsx
│   └── repos/
│       ├── repo-table.tsx        # Full TanStack Table with saved views
│       ├── health-badge.tsx
│       ├── commit-activity-chart.tsx
│       ├── tag-editor.tsx
│       ├── revenue-editor.tsx
│       ├── resync-button.tsx
│       ├── analyze-button.tsx
│       ├── analysis-tab.tsx
│       └── deployment-manager.tsx
├── lib/
│   ├── db/
│   │   ├── schema.ts             # Drizzle table definitions + relations
│   │   └── index.ts              # Neon HTTP connection
│   ├── github/
│   │   ├── client.ts             # Octokit factory
│   │   ├── sync.ts               # syncAllRepos, syncSingleRepo, rate limiting
│   │   ├── scanner.ts            # Tech stack detection from file contents
│   │   ├── security.ts           # Dependabot + secret scanning
│   │   └── deployments.ts        # GitHub Environments + Pages discovery
│   ├── health/
│   │   └── scoring.ts            # calculateHealthScore (pure function)
│   ├── monitoring/
│   │   └── uptime.ts             # fetch-based URL checker
│   ├── ai/
│   │   ├── summary.ts            # Claude AI repo summaries
│   │   └── analysis.ts           # Claude deep analysis (Phase 5)
│   └── actions/
│       ├── sync.ts               # triggerSync (uses after())
│       ├── repositories.ts       # getRepositories, getDashboardStats, analyzeRepo, etc.
│       └── deployments.ts        # addDeploymentUrl, discoverRepoDeployments, etc.
├── proxy.ts                      # Route protection (Next.js 16 proxy)
└── types/
    └── next-auth.d.ts            # Session type augmentation
```

---

## Database Schema

```
users
  id, name, email, image
  github_token          ← stored by Auth.js adapter, used for API calls
  last_synced_at

accounts                (provider, provider_account_id) composite PK
sessions                session_token PK, user_id FK, expires
verification_tokens     (identifier, token) composite PK

repositories
  id, user_id FK, github_id UNIQUE
  name, owner, full_name, visibility, description
  stars, forks, language, is_archived, is_fork
  is_revenue_generating, tags[]
  mrr, arr, monthly_cost          ← Phase 3 revenue fields
  ai_summary jsonb                ← { what_it_does, maturity, risk, recommendations[] }
  claude_analysis jsonb           ← { architecture, security, codeQuality, techDebt, recommendations[], overallScore }
  claude_analysis_at

repository_metrics      (one-to-one with repositories)
  health_score, activity_score, security_score
  documentation_score, testing_score, dependency_score, quality_score
  open_issues, open_prs
  weekly_commits, monthly_commits, quarterly_commits
  weekly_commit_data jsonb        ← [{ week: unix_ts, total: number }] × 13
  activity_status                 ← Actively Maintained | Low Activity | Dormant | Abandoned
  build_status                    ← success | failure | cancelled | in_progress

tech_stack              (one-to-one with repositories)
  frontend, backend, database, hosting, language
  testing, analytics, ai_tools, ci_cd

deployments             (many per repository)
  url, name, provider
  status                          ← healthy | slow | down | unknown
  response_time_ms, ssl_valid, http_status, last_checked

security_findings       (many per repository)
  type                            ← dependabot | secret | vulnerability
  severity                        ← critical | high | medium | low
  title, package_name, state

scans                   (one per sync job run)
  type                            ← sync | security | deployment | ai
  status                          ← pending | running | complete | failed
  total_repos, processed_repos, error
```

---

## Key Design Decisions

**`after()` for background work** — Server actions return immediately; `after()` from `next/server` hooks into Vercel's `waitUntil`, keeping the function alive for sync and analysis work after the HTTP response is sent. `revalidatePath` at the end busts the Next.js page cache.

**Neon HTTP driver** — `drizzle-orm/neon-http` works in serverless without persistent connections. It does not support transactions, so all writes are idempotent upserts with `onConflictDoUpdate`.

**Lateral joins sort in JS** — Drizzle's `findMany` with `with:` generates PostgreSQL lateral joins. Sorting by columns on the joined table (e.g. `repository_metrics.health_score`) cannot use SQL `ORDER BY` directly; it must happen in JavaScript after fetching.

**`proxy.ts` not `middleware.ts`** — Next.js 16 renamed middleware to "proxy". The file exports `proxy` (named export) and uses `config.matcher` for route filtering.

**Async request APIs** — Next.js 16 removed synchronous access to `cookies()`, `headers()`, `params`, and `searchParams`. Every usage is `await`ed.

**Prompt caching** — Claude analysis and summary calls include `cache_control: { type: 'ephemeral' }` on the system prompt, reducing cost when multiple repos are processed in the same time window.

**No client-side secrets** — GitHub tokens are stored in the `users` table (written by the Auth.js adapter) and only read server-side in sync and analysis functions. They are never sent to the browser.
