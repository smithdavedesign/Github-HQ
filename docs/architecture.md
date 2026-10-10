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
           │ agent_requests row (Neon) + BullMQ job (ids only)
           ▼
┌──────────────────────────┐      ┌────────────────────────────────────┐
│  Redis (Render Key Value)│ ←──→ │  Factory worker (factory/worker.ts)│
│  queue "factory"         │      │  owner's Mac, launchd KeepAlive    │
└──────────────────────────┘      │  Docker sandbox · LiteLLM/Ollama   │
                                  │  → draft PRs, findings, traces     │
                                  │    written back to Neon            │
                                  └────────────────────────────────────┘
```

The factory is the only thing that writes code (roadmap Phase 81, [PRD](agent-hq-migration-prd.md)). Neon is the source of truth; Redis only wakes the worker, which re-queues any open request it finds in Neon.

---

## The wider system

RepoHQ is the portfolio half of a larger loop: idea research → gstack review → $0 demand test → M1 build → revenue, plus the factory keeping repos healthy. See [system-overview.md](system-overview.md).

RepoHQ's parts in that loop:
- `POST /api/ideas/signal` (`src/lib/ideas/signals.ts`, table `idea_signals`): landing-page demand signals.
- The context index (`factory/context`): repos, ideas, bookmarks and docs by data class. It is served to agents by the MCP tools `get_system_overview` and `search_context`.
- The morning report's "Ideas, demand and revenue" section.
- Preview smoke (`factory/lib/smoke.ts`): each factory PR's Vercel preview is loaded in a browser next to production.

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
4. **Auto-Dispatch** — if enabled, filters advisor actions through effort/security/accuracy/lifecycle gates and queues eligible tasks for the factory

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

All routes require `Authorization: Bearer $CRON_SECRET`. GitHub Actions (`.github/workflows/cron-*.yml`) is the only trigger. GitHub disables scheduled workflows after 60 days without a commit, so the app shows a stale-data banner when no health snapshot has landed for two days, and the factory's morning report lists disabled workflows. The daily `gstack-self` Vercel cron was removed in the 2026-10 audit.

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
  event_type (agent):     agent_task_queued | agent_pr_created | agent_pr_merged | agent_execution_failed | agent_attempt | agent_skill_report | agent_ci_failed | agent_needs_human
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

**`'use server'` files export only async functions** — Plain objects or types exported from `'use server'` files cause Turbopack build failures. Constants live in plain `.ts` files (e.g., `src/lib/goals.ts`, `src/lib/lifecycle.ts`, `src/lib/skills/skill-policy.ts`).

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

*gstack*: `queue_gstack_skill(repo_name, skill, objective?)` — queues one of the 8 factory skills directly from Claude Code (allowlisted repos only). `get_skill_history(repo_name, skill?)` — prose-formatted run history. `get_skill_findings(repo_name, skill?)` — structured JSON findings + `suggestedNextSkill`.

**Advisor Learning Loop** — `src/lib/actions/advisor-accuracy.ts` + `advisor-accuracy-utils.ts` compute per-impactType accuracy from `portfolio_events` on-the-fly (no new table). Time-decay (30d × 2×), risk-adjusted suppress thresholds, `deltaConfidence` flag on resolved deltas. Accuracy table injected into the advisor's user message before each generation so Claude self-calibrates; never blocks advisor generation (try/catch wrapped). Accuracy shown as table on `/agent-performance` and inline confidence badges on the AdvisorCard.

**Auto-Dispatch** — `queueAdvisorActionForUser(userId, action)` (`src/lib/agents/factory-queue.ts`, server-only) is the session-less factory queue function called from the digest cron after `generateAdvisor()` completes. `autoDispatchAdvisorActions()` filters through 4 gates: effort gate → security gate → accuracy gate → lifecycle guard. Users configure via Settings → Agent Auto-Dispatch (5 fields on `users` table). `autoDispatched: true` tag on events for traceability. "Auto" badge shown on auto-dispatched events in the UI.

**Token Efficiency** — Two caches reduce redundant token spend as agent volume grows: (1) `repositories.cached_brief JSONB` — written by `get_coding_brief` on first call, served from cache within 6h, cleared on sync. (2) `digests.advisor_repo_snapshot JSONB` — the compiled repoLines prompt text, reused for 23h, invalidated on sync.

**Agent HQ queue (Phase 81)** — `enqueueRequest` in `src/lib/agents/factory-queue.ts` checks the owner (`FACTORY_USER_ID`), the factory allowlist (`factory/factory.config.json`), the skill policy and the lifecycle guard, then writes the `agent_requests` row and its `agent_task_queued` event in one batch and adds a BullMQ job (`jobId` = request id, so re-adding is idempotent). A failed Redis add leaves the row `queued`; the worker's reconcile (on start and after each cycle) re-adds it. The worker (`factory/worker.ts`) runs one job at a time: requests (priority 1), then the scheduled `cycle` / `report` / `scout` jobs that replaced the launchd calendar. Gates before each job: the `PAUSE` file, AC power, the run lock, Docker. A request that hits an environment problem is deferred (`queued` with a reason), never failed.

**Tracing** — every factory job and every Vercel cron route (`withAutomationRun`; `ai-summary` only when it queued work) writes an `automation_runs` row; the factory child process writes `trace_events` (clone, install, checks, route, attempt, judge, adversary, PR or report) and mirrors them to BullMQ job progress. `agent_jobs.request_id` links each tier attempt to its request. The Agents page (`/agent-performance`) shows the worker heartbeat (from Redis), queue counts, schedules, recent runs, requests and each one's trace; owner-only controls live in `src/lib/actions/automation.ts`. Runs older than 90 days are pruned by the daily report job.

**gstack skills** — the launcher keeps gstack's skill names and phases; the factory maps each to a mode (`modeForSkill`): `/ship`, `/qa`, `/document-release` → fix (one judged draft PR); `/investigate`, `/review`, `/qa-only`, `/health`, `/retro` → report (read-only, findings in an `agent_skill_report` event); `/canary` is unavailable (no browser in the sandbox). G1–G6 ran in the retired Nexus worker. See `docs/gstack-findings.md` for the running log.

**CI on agent PRs (Phase 55, reduced in Phase 81)** — `checkCIFailuresOnAgentPRs(userId)` runs before `checkMergedAgentPRs` in every 6h sync. It polls GitHub check-runs on open agent PRs, records `agent_ci_failed` once per head SHA, and escalates once to `agent_needs_human` with an in-app notification. There is no agent fix loop: the factory runs the repo's checks before it opens a PR, so a PR that still fails CI is the owner's call. `needs_human` is a blocking stage: new requests on the repo wait until the PR is merged or closed (`prFollowUpStage`: a merge is final, otherwise the newest PR event wins).

**Request correlation** — every agent event carries `metadata.taskId` = the `agent_requests` id. Lifecycle reads the row for factory requests; older Nexus tasks (pre-Phase 81) are still projected from their events by matching `taskId`; no new ones are created.

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
| Queue credentials leak | `REDIS_URL` lives in Vercel env and the Mac keychain only; jobs carry ids, so Redis holds no repo content or tokens |
| PR created without user knowledge | All PRs default `draft: true`; lifecycle guard prevents duplicate queuing |
| Auto-queue causing unreviewed work | Auto-dispatch gated by effort/accuracy/security settings; master toggle defaults off |
| Duplicate agent tasks | Server-side lifecycle guard in `queueAdvisorAction` and `queueGstackSkill` — both check `BLOCKING_STAGES` and open requests before queueing |

## Agent Execution — Lanes & Model Tiers (shipped, Phases 60–80)

Execution moved from one paid lane (Render worker → Anthropic) to a **cost ladder** run by the local factory (`factory/`), with every target repo's code in a throwaway Docker sandbox:

| Tier | Lane | Harness → model | Cost |
|------|------|-----------------|------|
| M0 Local | factory sandbox | Aider → `local-agent` (Qwen2.5-Coder 7B) via the egress relay → LiteLLM `:4000` | $0 |
| M1 Free cloud | factory sandbox | Claude Code `--bare` → `free-agent` pool (Ollama Cloud → OpenRouter → Gemini free tiers) | $0, quota-bound |
| MC Copilot | factory host only | GitHub Copilot CLI (prepaid seat); skipped while the sandbox is on | prepaid |
| M2 Paid | factory sandbox | Claude Code → `cloud-smart` (Anthropic) | $ (budget-gated; never in scheduled cycles) |

The router picks the cheapest tier with proven success per task difficulty (simple / medium / hard), subject to a data-classification gate (private repos skip M1 by default) and action-level approvals (L4 = merge/delete/force-push always need a human). A deterministic judge plus an advisory adversarial reviewer gate every PR, and merging is always human. Since Phase 81 the factory also runs every RepoHQ-dispatched request; the Nexus lane (Render worker → Anthropic) is retired. Full design: [autonomous-factory.md](autonomous-factory.md); operator guide: [factory/README.md](../factory/README.md).

## Needs you: review queue, next actions, PR value (2026-10-07)

The 30-day experiments ([roadmap](roadmap.md#next-30-days-four-experiments-2026-10-07--2026-11-06)) added three owner-facing pieces. Each has its pure logic in a module with relative imports only, so the dashboard and the factory's morning email share it:

| Piece | Pure logic | App (dashboard "Needs you") | Morning email |
|-------|------------|-----------------------------|---------------|
| Open PRs waiting for you | `src/lib/agents/open-prs.ts` (source, age, sort) | `src/lib/github/open-prs-query.ts`: one GitHub search (`is:pr is:open archived:false user:<login>`), factory PRs recognised from `agent_jobs` | `gh search prs --owner <owner>` per allowlist owner; first section, oldest first, 7+ days flagged |
| What to do next | `src/lib/portfolio/next-actions.ts` (decision state, reasons, one action, top 3) | `src/lib/portfolio/next-actions-query.ts` | `repoSignalsOf` in `factory/lib/sink.ts` |
| PR value | `src/lib/agents/pr-value.ts` (`value:0`…`value:5` labels) | `agent_jobs.value` → KPIs (avg value, useful PRs/night) | Reconcile creates the labels once per repo, reads them for 30 days after a merge, writes a `value` ledger entry and `agent_jobs.value` |

Both channels read the same per-repo signals (`src/lib/portfolio/repo-signals.ts`: lifecycle, focus, revenue, live deployments, CI, push age, open PRs, archive score, open critical/high findings, factory allowlist). Decision states are deterministic: blocked (something valuable is broken) → build (focus or in development) → explore (idea) → reconsider (sunsetting) → archive (no focus, revenue or live URL, and idle) → maintain.

---

## Retired: Nexus (AI-Took-My-Job)

Until Phase 81 a second executor, the Nexus service (Fastify API, BullMQ worker, Postgres and MinIO on Render, 27.7k LOC), took advisor and skill tasks to PRs. It had a success rate under 1% (2 merged of 306 queued), cost an always-on Render stack, and duplicated what the factory does with a sandbox and a judge. It was removed from this repo on 2026-10-07:

| Was | Now |
|-----|-----|
| `queueAdvisorAction` / `queueGstackSkill` POST to Nexus `/internal/agent-tasks` | Insert an `agent_requests` row and a BullMQ job (`factory-queue.ts`) |
| Nexus webhook (`/api/webhooks/agent-events`) writes lifecycle events | The factory writes events and traces straight to Neon |
| Nexus worker runs `gstack-*.sh` on Render | Factory worker on the owner's Mac, Docker sandbox, cost ladder, judge |
| Auto-chain (`suggestedNextSkill`) and the CI-fix loop | Removed; failing CI on an agent PR escalates to `needs human` |
| `gstack-self` Vercel cron | Removed; the factory senses RepoHQ like any other allowlisted repo |
| Render Redis owned by Nexus | Render Key Value from this repo's `render.yaml` (queue `factory`) |

The `AI-Took-My-Job` repo is archived after the trial week. Legacy Nexus events remain readable in `portfolio_events`.

---

## Agent Execution — Success Metrics

| Metric | Target | Gate |
|--------|--------|------|
| Queue click-through rate | > 30% of advisor actions shown | Phase A validation |
| Advisor accuracy (predicted vs actual delta) | > 70% | Unlock Phase B (MCP context) |
| Advisor accuracy | > 80% | Phase E (auto-queue) is deferred; this stays a quality target |
| Agent execution success rate | > 80% | Ongoing; measured from `agent_jobs` (factory), not the retired Nexus counters |
| PR merged rate | > 75% | Ongoing |
| Factory PR value (owner's `value:N` label) | average ≥ 2/5 | Night-shift gate, quality half (Experiment C) |
| Portfolio score gained from agents | Measurable upward trend | After 2 weeks |
| Zero production incidents | 100% | Always — draft PRs enforce this |
| Skill report closure rate (`log_attempt` called) | 100% | Always |

## Competitive Context (mid-2026)

What makes this combination novel: portfolio-level prioritisation (not arbitrary feature work) flowing into a review-gated execution pipeline with a learning loop. No other tool connects "scored opportunity → approved work item → agent branch → PR → accuracy measurement" as a single product flow.

| Tool | Portfolio Scoring | Agent Execution | Human Gate | Accuracy Loop |
|------|-----------------|-----------------|------------|---------------|
| RepoHQ alone | ✅ quantified | ❌ | — | — |
| Devin | ❌ | ✅ | minimal | ❌ |
| Copilot Workspace | ❌ | plan-only | ✅ | ❌ |
| OpenHands | ❌ | ✅ | none | ❌ |
| **RepoHQ + the factory** | **✅ quantified** | **✅** | **✅** | **✅** |
