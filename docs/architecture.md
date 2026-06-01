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

### Opportunity Score
```
opportunity_score =
  revenue_potential   × 0.30   (log-scale MRR if revenue; stars+deployment+activity proxy otherwise)
  activity_score      × 0.25   (same sub-score as health)
  health_score        × 0.25   (full health score)
  traffic_score       × 0.20   (log-scale stars; 500+ = max)
```

Both are pure functions in `src/lib/health/scoring.ts`. Recalculated on every sync.

### Portfolio Feed
`/feed` page computes events from existing tables on each page load (no dedicated events table):
- **Health drops/improvements** — compare latest vs oldest `health_score_history` row per repo
- **Down/slow deployments** — scan `deployments.status`
- **Security alerts** — scan `security_findings` for open critical/high findings
- **Dormant repos** — `repository_metrics.last_push` > 90 days ago
- **Failing builds** — `repository_metrics.build_status = 'failure'`

Sorted by severity (critical → warning → info → positive), then date descending.

### Lifecycle Status
User-set enum on every repo: `idea | building | beta | production | growing | maintaining | sunsetting | archived`.
Stored in `repositories.lifecycle_status`. Updated via server action from repo detail page.
Displayed as a sortable badge column in the repos table and aggregated on the dashboard.

### Scheduled Jobs
Vercel Cron hits each endpoint (`Authorization: Bearer $CRON_SECRET`):

| Endpoint | Time (UTC) | What it does |
|----------|-----------|-------------|
| `/api/cron/sync` | 02:00 daily | Full GitHub sync for all users + health score snapshot |
| `/api/cron/security` | 03:00 daily | Dependabot + secret scanning, recalculates health |
| `/api/cron/deployments` | 04:00 daily | Uptime check for all deployment URLs |
| `/api/cron/ai-summary` | 05:00 Sunday | Regenerates Claude AI summaries |
| `/api/cron/digest` | 06:00 Monday | Weekly AI digest + advisor + CEO report per user |

---

## File Structure

```
src/
├── app/
│   ├── (app)/                    # Route group — shared authenticated layout
│   │   ├── layout.tsx            # Auth check, Sidebar, Topbar
│   │   ├── page.tsx              # Dashboard (metrics, P&L, lifecycle, opportunity, digest)
│   │   ├── repos/
│   │   │   ├── page.tsx          # Repos table (TanStack) — server page
│   │   │   └── [id]/page.tsx     # Repo detail with tabs
│   │   ├── feed/page.tsx         # Portfolio health feed (Phase 12)
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
   │   ├── health-trend-chart.tsx
   │   ├── archive-candidates-card.tsx  ← Phase 22: repos with archive_score ≥ 70
   │   ├── ceo-report-card.tsx          ← Phase 24: weekly CEO report card
   │   └── time-allocation-card.tsx     ← Phase 25: top-N repos by value delta
   └── repos/
       ├── repo-table.tsx        # Full TanStack Table with saved views
       ├── health-badge.tsx
       ├── commit-activity-chart.tsx
       ├── tag-editor.tsx
       ├── revenue-editor.tsx
       ├── cost-items-editor.tsx        ← Phase 23: itemized cost line items
       ├── purpose-selector.tsx         ← Phase 21: purpose enum selector
       ├── focus-toggle.tsx             ← Phase 21: is_focused star button
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
   │   ├── analysis.ts           # Claude deep analysis (Phase 5)
   │   ├── digest.ts             # Weekly briefing generation (Phase 8)
   │   ├── advisor.ts            # Advisor card (Phase 14)
   │   └── ceo-report.ts         # Weekly CEO report generation (Phase 24)
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
  lifecycle_status                ← idea|building|beta|production|growing|maintaining|sunsetting|archived
  mrr, arr, monthly_cost          ← Phase 3 revenue fields
  purpose                         ← Phase 21: Revenue|Learning|Consulting|Experiment|Open Source|Client Work|Portfolio|Infrastructure
  is_focused                      ← Phase 21: boolean, default false
  cost_items jsonb                ← Phase 23: [{ label, amount }]; sum stored in monthly_cost
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
  opportunity_score               ← 0-100 weighted score (Phase 4)
  archive_score                   ← Phase 22: 0-100; ≥70 = strong archive candidate; capped at 30 for revenue repos
  estimated_value, valuation_confidence, valuation_method  ← Phase 15

digests
  user_id FK, content jsonb       ← weekly briefing text
  advisor_content jsonb           ← advisor card (Phase 14)
  ceo_report jsonb                ← Phase 24: { portfolioSummary, biggestWins[], biggestRisks[], recommendedFocus[], closingLine, generatedAt }
  created_at

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
