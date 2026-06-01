# RepoHQ — Architecture

## System Overview

RepoHQ is a Next.js 16 App Router application that syncs GitHub repository data into Neon PostgreSQL and surfaces it as an AI-powered portfolio health dashboard.

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
│  proxy.ts       (route guard)         │
│                                       │
│  ┌────────────────┐  ┌─────────────┐  │
│  │  Neon Postgres │  │  Anthropic  │  │
│  │  (Drizzle ORM) │  │   Claude    │  │
│  └────────────────┘  └─────────────┘  │
└───────────────────────────────────────┘
```

---

## Key Flows

### Authentication
1. User visits `/login` → clicks "Continue with GitHub"
2. Auth.js v5 initiates GitHub OAuth (`repo read:user read:org security_events` scopes)
3. Callback hits `/api/auth/callback/github`
4. DrizzleAdapter creates/updates `users` row; session written to `sessions` table
5. `events.signIn` stores the GitHub access token + `githubLogin` on the user record
6. `proxy.ts` (Next.js 16 proxy — formerly `middleware.ts`) guards all authenticated routes

### Sync
1. User clicks **Sync** → `triggerSync()` server action returns immediately
2. `after()` from `next/server` defers `syncAllRepos()` — Vercel's `waitUntil` keeps the function alive after the response
3. For each repo, sync fetches and computes:
   - Commit activity (13 weeks), open PRs/issues/releases, GitHub Actions build status
   - Repository intelligence (package.json, Prisma schema, Docker Compose, config files)
   - README quality score
   - Health score, opportunity score, archive score, valuation
4. Health score snapshot written to `health_score_history` (idempotent — one row per repo per day)
5. Goal progress refreshed for all auto-tracked goal types
6. `revalidatePath('/', 'layout')` busts Next.js page cache
7. Client polls `/api/sync-status` every 3s via TanStack Query — progress bar renders live

### Scoring
```
health_score =
  activity_score      × 0.20   (commits, PRs, releases — last 90 days)
  security_score      × 0.20   (100 − penalty per open Dependabot/secret alert)
  deployment_score    × 0.15   (uptime status of configured URLs)
  documentation_score × 0.15   (README quality: installation, env, screenshots)
  testing_score       × 0.10   (detected test framework in package.json)
  dependency_score    × 0.10   (days since last push)
  quality_score       × 0.10   (default 70)

opportunity_score =
  revenue_potential   × 0.30   (log-scale MRR if revenue; stars+deployment+activity proxy otherwise)
  activity_score      × 0.25
  health_score        × 0.25
  traffic_score       × 0.20   (log-scale stars; 500+ = max)

archive_score =
  inactivity          × 0.35   (commit silence + days since push)
  no_revenue          × 0.25   (zero MRR = 100; any MRR = 0)
  no_deployment       × 0.20
  low_health          × 0.10
  low_opportunity     × 0.10
  # Revenue repos capped at 30; already-archived = 0

valuation =
  saas_multiple       MRR × 36–60× (adjusted for health and activity momentum)
  signal_based        stars × $20 + deployment bonus (non-revenue repos)
```

All scoring is pure functions in `src/lib/health/scoring.ts` and `src/lib/health/valuation.ts`. Recalculated on every sync.

### Monday Cron (Digest + Advisor + CEO Report)
`/api/cron/digest` runs Mondays at 06:00 UTC and generates three artifacts in parallel for each user:

1. **Triage Digest** — top 3 portfolio priorities with urgency, reason, action (claude-haiku, cached prompt)
2. **Portfolio Advisor** — pre-computes opportunity score deltas per repo, then asks Claude for top 5 quantified actions
3. **CEO Report** — portfolio summary, biggest wins, biggest risks, recommended focus (claude-haiku, cached prompt)

All stored as jsonb columns on the `digests` row. Dashboard cards show the most recent if < 8 days old.

### Portfolio Feed
`/feed` computes events from existing tables on each page load (no dedicated events table):
- Health drops/improvements (from `health_score_history`)
- Down/slow deployments (from `deployments.status`)
- Critical/high security alerts (from `security_findings`)
- Dormant repos (`last_push` > 90 days)
- Failing builds (`build_status = 'failure'`)

Sorted: critical → warning → info → positive, then date descending.

### Public Portfolio
`/u/[githubLogin]` — no auth, ISR 1h. Only shows public repos for users with `publicProfile = true`.
- `/u/[username]/resume` — print-friendly portfolio with skills, top projects, stats
- `/u/[username]/report/[YYYY-q#]` — quarterly report with AI commentary via claude-haiku
- `/u/[username]/opengraph-image` — dynamic 1200×630 OG image (edge runtime)

---

## Scheduled Jobs

| Endpoint | Time (UTC) | What it does |
|----------|-----------|-------------|
| `/api/cron/sync` | 02:00 daily | Full GitHub sync + health snapshot + goal refresh |
| `/api/cron/security` | 03:00 daily | Dependabot + secret scanning, recalculates health |
| `/api/cron/deployments` | 04:00 daily | Uptime checks for all deployment URLs |
| `/api/cron/ai-summary` | 05:00 Sunday | Regenerates Claude AI summaries for all repos |
| `/api/cron/digest` | 06:00 Monday | Digest + Advisor + CEO Report per user |

All routes require `Authorization: Bearer $CRON_SECRET`.

---

## Database Schema

```
users
  id, name, email, image
  github_login, github_id, github_token
  last_synced_at, public_profile

accounts / sessions / verification_tokens   ← Auth.js adapter tables

repositories
  id, user_id FK, github_id UNIQUE
  name, owner, full_name, visibility, description
  stars, forks, language, is_archived, is_fork
  lifecycle_status        idea|building|beta|production|growing|maintaining|sunsetting|archived
  purpose                 Revenue|Learning|Consulting|Experiment|Open Source|Client Work|Portfolio|Infrastructure
  is_focused              boolean — star for advisor/CEO report priority
  tags[]
  is_revenue_generating, mrr, arr, monthly_cost
  cost_items              jsonb  [{label, amount}]
  ai_summary              jsonb  {what_it_does, maturity, risk, recommendations[]}
  claude_analysis         jsonb  {architecture, security, codeQuality, techDebt, recommendations[], overallScore}
  claude_analysis_at

repository_metrics        (one-to-one with repositories)
  health_score, activity_score, security_score
  documentation_score, testing_score, dependency_score, quality_score
  open_issues, open_prs
  weekly_commits, monthly_commits, quarterly_commits
  weekly_commit_data      jsonb  [{week: unix_ts, total}] × 13
  activity_status         Actively Maintained | Low Activity | Dormant | Abandoned
  build_status            success | failure | cancelled | in_progress
  opportunity_score       0-100 weighted score
  archive_score           0-100 (capped at 30 for revenue repos)
  estimated_value         USD integer
  valuation_confidence    none | very_low | low | medium
  valuation_method        saas_multiple | signal_based | archived

tech_stack                (one-to-one with repositories)
  frontend, backend, database, hosting, language, testing, analytics, ai_tools, ci_cd

deployments               (many per repository)
  url, name, provider, status, response_time_ms, ssl_valid, http_status, last_checked

security_findings         (many per repository)
  type (dependabot|secret), severity (critical|high|medium|low), title, state

health_score_history      (many per repository — one row per day)
  repo_id, health_score, activity_score, security_score
  recorded_date (unique constraint with repo_id)

scans                     sync job run progress
  user_id, type, status, total_repos, processed_repos, error

digests                   weekly AI content per user
  user_id, content (briefing), advisor_content, ceo_report, generated_at

goals                     user-set portfolio targets
  user_id, type, name, target_value, current_value, unit, deadline, is_active, completed_at
```

---

## Key Design Decisions

**`after()` for background work** — Server actions return immediately. `after()` from `next/server` hooks into Vercel's `waitUntil`, keeping the function alive for sync, analysis, and AI generation after the HTTP response is sent. `revalidatePath` at the end busts the Next.js page cache.

**Neon HTTP driver** — `drizzle-orm/neon-http` works in serverless without persistent connections. Does not support transactions — all writes are idempotent upserts with `onConflictDoUpdate`.

**Lateral joins sort in JS** — Drizzle's `findMany` with `with:` generates PostgreSQL lateral joins. Sorting by columns on the joined table must happen in JavaScript after fetching.

**`proxy.ts` not `middleware.ts`** — Next.js 16 renamed middleware to "proxy". Exports named `proxy` function with `config.matcher`.

**Async request APIs** — Next.js 16 removed synchronous access to `cookies()`, `headers()`, `params`, `searchParams`. All must be `await`ed.

**`'use server'` files export only async functions** — Plain objects or types exported from `'use server'` files cause Turbopack build failures. Constants live in plain `.ts` files (e.g., `src/lib/goals.ts`, `src/lib/lifecycle.ts`).

**Prompt caching** — Claude analysis, digest, advisor, and CEO report calls include `cache_control: { type: 'ephemeral' }` on system prompts. Reduces cost significantly for Monday bulk runs.

**No client-side secrets** — GitHub tokens stored in `users` table (written by Auth.js adapter), only read server-side. Never sent to the browser.

**Claude model selection** — `claude-sonnet-4-6` for deep repo analysis (quality matters). `claude-haiku-4-5` for digest, advisor, CEO report, NL query, and quarterly reports (speed + cost).
