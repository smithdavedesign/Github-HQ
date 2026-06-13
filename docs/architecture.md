# RepoHQ — Architecture

## System Overview

RepoHQ is a Next.js 16 App Router application that syncs GitHub repository data into Neon PostgreSQL and surfaces it as an AI-powered portfolio health dashboard with an integrated agent execution pipeline.

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
│  Route Handlers ←── GitHub Actions ──┘│
│  proxy.ts       (route guard)         │
│                                       │
│  ┌────────────────┐  ┌─────────────┐  │
│  │  Neon Postgres │  │  Anthropic  │  │
│  │  (Drizzle ORM) │  │   Claude    │  │
│  └────────────────┘  └─────────────┘  │
└───────────────────────────────────────┘
           │ POST /internal/agent-tasks
           ▼
┌──────────────────────────┐
│  AI-Took-My-Job / Nexus  │
│  BullMQ + gstack scripts │
└──────────────────────────┘
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

### Monday Cron (Digest + Advisor + CEO Report + Auto-Dispatch)
`/api/cron/digest` runs Mondays at 06:00 UTC and generates three artifacts in parallel for each user, then runs auto-dispatch:

1. **Triage Digest** — top 3 portfolio priorities with urgency, reason, action (claude-haiku, cached prompt)
2. **Portfolio Advisor** — pre-computes opportunity score deltas per repo, then asks Claude for top 5 quantified actions
3. **CEO Report** — portfolio summary, biggest wins, biggest risks, recommended focus (claude-haiku, cached prompt)
4. **Auto-Dispatch** — if enabled, filters advisor actions through effort/security/accuracy/lifecycle gates and queues eligible tasks to Nexus

All stored as jsonb columns on the `digests` row. Dashboard cards show the most recent if < 8 days old.

### Portfolio Feed
`/feed` has two tabs:

**Feed tab** — computed from existing tables on each page load:
- Health drops/improvements (from `health_score_history`)
- Down/slow deployments (from `deployments.status`)
- Critical/high security alerts (from `security_findings`)
- Dormant repos (`last_push` > 90 days)
- Failing builds (`build_status = 'failure'`)
- Dependency cascade risk (if a dep repo has health < 60, warn dependent repos)

Sorted: critical → warning → info → positive, then date descending.

**Milestones tab** — from `portfolio_events` table:
- Auto-captured during sync: new repos, archives, MRR changes ≥$10, health milestones at 70/80/90
- Manual free-text milestones added by the user
- Timeline view grouped by month; annual markdown export at `/api/changelog/export?year=YYYY`

### Public Portfolio
`/u/[githubLogin]` — no auth, ISR 1h. Only shows public repos for users with `publicProfile = true`.
- `/u/[username]/resume` — print-friendly portfolio with skills, top projects, stats
- `/u/[username]/report/[YYYY-q#]` — quarterly report with AI commentary via claude-haiku
- `/u/[username]/opengraph-image` — dynamic 1200×630 OG image (edge runtime)

---

## Scheduled Jobs

| Endpoint | Trigger | Time (UTC) | What it does |
|----------|---------|-----------|-------------|
| `/api/cron/sync` | GitHub Actions | every 6h | Full GitHub sync + health snapshot + goal refresh + PR merge detection + delta resolution + health alerts |
| `/api/cron/security` | GitHub Actions | 03:00 daily | Dependabot + secret scanning, recalculates health |
| `/api/cron/deployments` | GitHub Actions | every 12h | Uptime checks for all deployment URLs |
| `/api/cron/ai-summary` | GitHub Actions | 05:00 Sunday | Enqueues per-repo AI summary jobs then processes them in a loop |
| `/api/cron/digest` | GitHub Actions | 06:00 Monday | Digest + Advisor + CEO Report + Auto-Dispatch per user |
| `/api/cron/gstack-self` | Vercel cron | 07:00 daily | Self-scan RepoHQ with /health + /qa-only → auto-queues fix tasks |

All routes require `Authorization: Bearer $CRON_SECRET`. GitHub Actions (`.github/workflows/cron-*.yml`) is the canonical trigger for all jobs except `gstack-self`, which runs daily via Vercel cron (no GitHub Actions equivalent since it runs continuously, not on a branch push schedule).

---

## Database Schema

```
users
  id, name, email, image
  github_login, github_id, github_token          ← AES-256-GCM encrypted (enc: prefix)
  last_synced_at, public_profile
  llm_provider, llm_keys jsonb                   ← per-provider keys, AES-256-GCM encrypted
  auto_dispatch_enabled, auto_dispatch_effort_gate
  auto_dispatch_max_per_run, auto_dispatch_skip_security
  auto_dispatch_accuracy_threshold

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
  cached_brief            jsonb  {raw: string, generatedAt: string}  ← Phase 54 brief cache

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
  internal_deps           jsonb  string[] — names of other portfolio repos this repo depends on

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
  advisor_repo_snapshot   jsonb  ← Phase 54 advisor prompt cache (23h TTL)

goals                     user-set portfolio targets
  user_id, type, name, target_value, current_value, unit, deadline, is_active, completed_at

portfolio_events          personal changelog + agent event log
  user_id, repo_id FK (nullable), event_type, title, description, metadata jsonb, dedup_key, occurred_at
  event_type (changelog): repo_created | repo_archived | mrr_changed | health_milestone | first_revenue | manual_milestone | session_complete
  event_type (agent):     agent_task_queued | agent_pr_created | agent_pr_merged | agent_execution_failed | agent_attempt | agent_skill_report
  dedup_key: unique per (userId, dedupKey) — onConflictDoNothing prevents duplicate one-time events

notifications             push notification inbox
  user_id, repo_id FK (nullable), event_type, title, body, metadata jsonb, read_at, created_at
  event_type: health_alert | agent_pr_ready | agent_pr_merged | agent_failed | security_critical

portfolio_score_history   daily composite score per user
  user_id, score, avg_health, activity_ratio, revenue_score, diversity_score, recorded_date
  unique on (userId, recordedDate)
```

---

## Scoring Functions (pure, testable)

All live in `src/lib/health/` with full Vitest coverage:

```
calculateHealthScore()        7-factor weighted: activity, security, deployment, docs, testing, dependency, quality
calculateOpportunityScore()   4-factor: revenue 30%, activity 25%, health 25%, stars 20%
calculateArchiveScore()       5-factor: inactivity, no revenue, no deployment, low health, low opportunity
calculateValuation()          SaaS multiple (MRR repos) or signal-based (non-revenue)
calculatePortfolioScore()     4-factor composite: health 40%, activity 25%, revenue 25%, diversity 10%
calculateShowcaseScore()      Rates public repos for GitHub profile pinning: health 40%, stars 20%, focus 15%, deployment 15%, purpose 10%
runSimulation()               Greedy ROI-per-hour allocation given N hours and a goal type
computeOpportunityCost()      Compares repos worked on vs highest-value untouched repos
computePortfolioEvents()      Pure event derivation from repo state changes (dedup via dedup_key)
computeInternalDeps()         Cross-references package.json deps across portfolio repos
```

595+ unit tests across 36 files. Zero DB calls in any scoring function.

**`dbOp()` error wrapper** — all write-path server actions in `src/lib/actions/repositories.ts` and related files are wrapped in `dbOp(label, fn)`. Catches raw Neon/Drizzle errors, logs server-side with context, surfaces a clean user-facing message. Auth errors pass through unchanged.

**SSRF protection** — `isBlockedUrl(url)` in `src/lib/notifications/webhook.ts` blocks loopback, cloud metadata (169.254.169.254), and all private IPv4 ranges. Applied to the user-configured webhook sender and the deployment URL health checker. Both use `redirect: 'manual'` to prevent redirect-based SSRF bypasses. The uptime checker treats 2xx and 3xx as "healthy" (`response.status < 400`) — with `redirect: 'manual'`, a 3xx means the site is responding; only 4xx/5xx and network errors count as "down".

---

## Key Design Decisions

**`after()` for background work** — Server actions return immediately. `after()` from `next/server` hooks into Vercel's `waitUntil`, keeping the function alive for sync, analysis, and AI generation after the HTTP response is sent. `revalidatePath` at the end busts the Next.js page cache.

**Neon HTTP driver** — `drizzle-orm/neon-http` works in serverless without persistent connections. Does not support transactions — all writes are idempotent upserts with `onConflictDoUpdate`.

**Lateral joins sort in JS** — Drizzle's `findMany` with `with:` generates PostgreSQL lateral joins. Sorting by columns on the joined table must happen in JavaScript after fetching.

**`proxy.ts` not `middleware.ts`** — Next.js 16 renamed middleware to "proxy". Exports named `proxy` function with `config.matcher`.

**Async request APIs** — Next.js 16 removed synchronous access to `cookies()`, `headers()`, `params`, `searchParams`. All must be `await`ed.

**`'use server'` files export only async functions** — Plain objects or types exported from `'use server'` files cause Turbopack build failures. Constants live in plain `.ts` files (e.g., `src/lib/goals.ts`, `src/lib/lifecycle.ts`, `src/lib/actions/nexus-utils.ts`).

**Prompt caching** — Claude analysis, digest, advisor, and CEO report calls include `cache_control: { type: 'ephemeral' }` on system prompts. Reduces cost significantly for Monday bulk runs.

**Encryption at rest** — `github_token` and `llm_keys` are AES-256-GCM encrypted before writing to Postgres. `encrypt()` / `decrypt()` in `src/lib/crypto-utils.ts` use a 32-byte `ENCRYPTION_KEY` env var. `decrypt()` passes plaintext values (no `enc:` prefix) through unchanged for zero-downtime migration from legacy records. All Octokit client construction and LLM adapter factory calls go through `decrypt()` first. Never stored in client state.

**No client-side secrets** — GitHub tokens stored in `users` table (written by Auth.js adapter), encrypted at rest, and only read server-side. Never sent to the browser.

**Claude model selection** — `claude-sonnet-4-6` for deep repo analysis (quality matters). `claude-haiku-4-5` for digest, advisor, CEO report, NL query, and quarterly reports (speed + cost).

**Stripe integration** — Plain fetch against Stripe REST API (no SDK). Restricted key with Subscriptions + Products read-only. MRR auto-syncs alongside daily GitHub sync. `resolveApiKey()` checks DB-stored key first, falls back to `STRIPE_API_KEY` env var for local dev.

**MCP Server** — `mcp/server.ts` is a stdio MCP server using `@modelcontextprotocol/sdk`. Queries Neon directly via `DATABASE_URL` + `MCP_USER_ID` env vars. Configured in `~/.claude/claude.json`.

14 tools across five tiers:

*Diagnostic (read-only)*: `get_portfolio_summary`, `get_repo_context`, `get_portfolio_warnings`, `get_top_opportunities`, `get_active_goals`

*Agentic*: `get_coding_brief` — full session-start doc including in-flight PRs, attempt history, last skill report findings; served from `repositories.cached_brief` within 6h. `get_next_action` — top ROI task, skips repos with open PRs and dead-end actions, includes confidence line. `log_session_complete` — writes `session_complete` portfolio_event.

*Active Work + Feedback*: `get_active_work(repo_name?)` — shows open agent PRs, safe-to-start flag. `log_attempt(repo_name, action, outcome, reason)` — writes `agent_attempt` event, feeds dead-end detection.

*Learning Loop*: `get_accuracy_report()` — full calibration table (success rate, avg delta, signal strength per impactType) + downgraded repos.

*gstack*: `queue_gstack_skill(repo_name, skill, objective?)` — queues any of the 9 skills directly from Claude Code. `get_skill_history(repo_name, skill?)` — prose-formatted run history. `get_skill_findings(repo_name, skill?)` — structured JSON findings + `suggestedNextSkill`.

**Advisor Learning Loop** — `src/lib/actions/advisor-accuracy.ts` + `advisor-accuracy-utils.ts` compute per-impactType accuracy from `portfolio_events` on-the-fly (no new table). Time-decay (30d × 2×), risk-adjusted suppress thresholds, `deltaConfidence` flag on resolved deltas. Accuracy table injected into the advisor's user message before each generation so Claude self-calibrates; never blocks advisor generation (try/catch wrapped). Accuracy shown as table on `/agent-performance` and inline confidence badges on the AdvisorCard.

**Auto-Dispatch** — `queueAdvisorActionForUser(userId, action)` is a session-less Nexus queue function called from the digest cron after `generateAdvisor()` completes. `autoDispatchAdvisorActions()` filters through 4 gates: effort gate → security gate → accuracy gate → lifecycle guard. Users configure via Settings → Agent Auto-Dispatch (5 fields on `users` table). `autoDispatched: true` tag on events for traceability. "Auto" badge shown on auto-dispatched events in the UI.

**Token Efficiency** — Two caches reduce redundant token spend as agent volume grows: (1) `repositories.cached_brief JSONB` — written by `get_coding_brief` on first call, served from cache within 6h, cleared on sync. (2) `digests.advisor_repo_snapshot JSONB` — the compiled repoLines prompt text, reused for 23h, invalidated on sync.

**gstack Integration** — G1–G6 fully shipped. `skillName` in Nexus `contextNotes` selects the correct gstack script in the Nexus worker. `OPENCLAW_SESSION=true` enables real skill invocation. Learnings from `~/.gstack/projects/{slug}/learnings.jsonl` are injected before each run. Checkpoint mode (`continuous`) keeps WIP commits alive through crashes. `agent_skill_report` webhook event stores findings + `suggestedNextSkill`; `get_coding_brief` surfaces the last skill report findings. See `docs/gstack-findings.md` for the running log.

**Pure function extraction** — All scoring, simulation, event derivation, and dep-analysis logic lives in plain `.ts` files with no DB imports. Server actions and sync code call these functions. This pattern makes everything testable without DB mocks and keeps server action files thin.

---

## Agent Execution — Risk Tiers & Safety Gates

All agent tasks are classified by risk tier. Do not route to a higher tier until the lower tier has proven ≥80% advisor accuracy over 20+ executions.

| Tier | Task Types | Skill | Safety |
|------|-----------|-------|--------|
| Tier 1 | Documentation gaps, README improvements | `/ship` | Any failure is immediately obvious; revert is trivial |
| Tier 2 | Dependency updates, CI/test fixes | `/ship` | Clear test criteria (tests pass = success); revert is one-line diff |
| Tier 3 | Security alert fixes, investigations | `/investigate` | Only after Tier 1-2 proven; a wrong security fix can introduce new vulnerabilities |
| Blocked | Feature work, architecture changes, auth/payments/migrations | — | Never in scope for autonomous execution |

**NOT in scope for autonomous agents:** Feature work, architectural changes, major refactors, cross-repo coordinated changes, anything touching auth, payments, or data migrations.

## Agent Execution — Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Advisor accuracy too low | Track `predictedDelta` vs `actualDelta` from Day 1; phase gates prevent advancing until ≥70% (B) and ≥80% (E) |
| Agent context loss | Coding brief capped at 6h TTL; one action per execution; snapshot memoization |
| Security fix introduces new vulnerability | Security in Tier 3 only, after Tier 1-2 proven safe over 20+ executions |
| Approval bottleneck | Auto-dispatch with effort gate + accuracy gate; never auto-queues without user consent |
| Nexus API auth leak | Service token in RepoHQ env vars only, never stored in DB |
| PR created without user knowledge | All PRs default `draft: true`; lifecycle guard prevents duplicate queuing |
| Auto-queue causing unreviewed work | Auto-dispatch gated by effort/accuracy/security settings; master toggle defaults off |
| Duplicate agent tasks | Server-side lifecycle guard in `queueAdvisorAction` and `queueGstackSkill` — both check `BLOCKING_STAGES` before posting to Nexus |

## Agent Execution — Success Metrics

| Metric | Target | Gate |
|--------|--------|------|
| Queue click-through rate | > 30% of advisor actions shown | Phase A validation |
| Advisor accuracy (predicted vs actual delta) | > 70% | Unlock Phase B (MCP context) |
| Advisor accuracy | > 80% | Unlock Phase E (auto-queue) |
| Agent execution success rate | > 80% | Ongoing from Phase A.5 |
| PR merged rate | > 75% | Ongoing |
| Portfolio score gained from agents | Measurable upward trend | After 2 weeks |
| Zero production incidents | 100% | Always — draft PRs enforce this |
| Skill report closure rate (`log_attempt` called) | 100% | Always |

## Competitive Context (mid-2026)

What makes this combination novel: portfolio-level prioritisation (not arbitrary feature work) flowing into a review-gated execution pipeline with a learning loop. No other tool connects "scored opportunity → approved work item → agent branch → PR → accuracy measurement" as a single product flow.

| Tool | Portfolio Scoring | Agent Execution | Human Gate | Accuracy Loop |
|------|-----------------|-----------------|------------|---------------|
| RepoHQ alone | ✅ quantified | ❌ | — | — |
| AI-Took-My-Job alone | ❌ | ✅ | ✅ | ❌ |
| Devin | ❌ | ✅ | minimal | ❌ |
| Copilot Workspace | ❌ | plan-only | ✅ | ❌ |
| OpenHands | ❌ | ✅ | none | ❌ |
| **RepoHQ + Nexus + gstack** | **✅ quantified** | **✅** | **✅** | **✅** |
