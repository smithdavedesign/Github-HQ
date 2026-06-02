# RepoHQ — Roadmap

## Shipped

### Phase 1 — Core Dashboard
- [x] GitHub OAuth with `repo`, `read:user`, `read:org`, `security_events` scopes
- [x] Full repo sync (public + private) with pagination via Octokit
- [x] Health score engine — 7-factor weighted formula
- [x] Repository intelligence scanner — detects framework, language, DB, hosting, CI/CD, AI tools
- [x] TanStack Table — sorting, filtering, column visibility, CSV export
- [x] Security dashboard — Dependabot alerts and secret scanning by severity
- [x] Production URL monitoring — uptime, response time, SSL
- [x] AI repo summaries — Claude: what it does, maturity, risk, next actions
- [x] Neon PostgreSQL + Drizzle ORM
- [x] Vercel Cron for automated daily updates
- [x] Dark mode
- [x] Settings page
- [x] 142 unit tests (Vitest) · 38 e2e tests (Playwright)

### Phase 2 — Deeper Insights
- [x] Real-time sync progress bar (TanStack Query polls `/api/sync-status` every 3s)
- [x] Per-repo manual re-sync button
- [x] Rate limit guard — backs off at `X-RateLimit-Remaining` < 300
- [x] GitHub Actions build status fetched during sync
- [x] 13-week commit activity chart (Recharts) on repo detail
- [x] Tags editor — inline chip input, persists to DB
- [x] Saved views — save/load/delete column + sort presets (localStorage)
- [x] Revenue flag toggle in the table row
- [x] MRR and Build Status columns

### Phase 3 — Revenue & Cost Tracking
- [x] MRR, ARR, monthly cost fields per repo (Revenue tab)
- [x] Live profit and margin preview
- [x] Portfolio P&L summary on dashboard (hidden until data exists)
- [x] MRR column in repos table (sortable)

### Phase 4 — Opportunity Scoring
- [x] 4-factor weighted formula: Revenue Potential × 30%, Activity × 25%, Health × 25%, Stars × 20%
- [x] "Needs Attention" + "Dormant but Promising" cards on dashboard
- [x] Opportunity column in repos table
- [x] 24 unit tests

### Phase 5 — Claude Code Integration
- [x] Per-repo deep analysis: architecture, security, code quality, tech debt
- [x] Prioritised action plan (High/Medium/Low)
- [x] Overall Claude score 0–100, stored in DB, Analysis tab on detail page

### Phase 6 — Extended Deployment Support
- [x] Auto-discover from GitHub Environments + GitHub Pages
- [x] Provider auto-detection (Vercel, Netlify, Render, Railway, Fly, Pages, AWS, Azure)
- [x] Deployment manager on repo detail — add, remove, check, auto-discover

### Phase 7 — Shareable Portfolio View
- [x] Public route `/u/[githubLogin]` — no auth, ISR 1h
- [x] Opt-in toggle in Settings
- [x] Profile card, health badges, tech stack, AI summary, deployment dots

### Phase 8 — Automated Triage Digest
- [x] `digests` table — weekly Claude briefing per user
- [x] Top 3 priorities with urgency, reason, action, repo link
- [x] Monday 06:00 UTC cron
- [x] "Weekly AI Briefing" card on dashboard (< 8 days old)

### Phase 9 — Health Score History
- [x] `health_score_history` table — unique on `(repo_id, recorded_date)`
- [x] Daily snapshot after sync (idempotent)
- [x] `getHealthTrend()` compares current to oldest snapshot
- [x] HealthBadge ↑/↓ arrow after 7+ days of data
- [ ] 30-day trend line on Analytics page — waiting for data (~30 syncs)

### Phase 10 — Natural Language Query
- [x] Sparkle input above repos table — plain English filters
- [x] `/api/nl-query` — claude-haiku returns structured `NLQueryFilters` (no raw SQL)
- [x] 14-field vocabulary: health, activity, last push, visibility, language, framework, DB, revenue, security, stars, MRR, sort
- [x] 28 unit tests

### Phase 11 — Repository Lifecycle Status
- [x] 8-stage enum: Idea → Building → Beta → Production → Growing → Maintaining → Sunsetting → Archived
- [x] Lifecycle selector on repo detail Overview tab
- [x] Lifecycle badge column in repos table
- [x] Dashboard distribution card

### Phase 12 — Portfolio Health Feed
- [x] `/feed` page — health drops, deployments, security alerts, dormant repos, failing builds
- [x] Sorted by severity (critical → warning → info → positive)

### Phase 13 — Technical Debt Visibility
- [x] Tech Debt column in repos table (reads from `claude_analysis.techDebt.level`)
- [x] Low / Medium / High badge, custom sort order

### Phase 14 — AI Portfolio Advisor
- [x] Pre-computes opportunity score deltas per repo before calling Claude
- [x] Top 5 actions: repo, verb phrase, effort, exact delta, reasoning
- [x] AdvisorCard on dashboard with Generate / Regenerate button
- [x] Runs alongside digest cron every Monday

### Phase 15 — Repository Valuation Engine
- [x] SaaS multiple: MRR × 36–60× (adjusted for health + activity)
- [x] Signal-based: stars × $20 + deployment bonus (adjusted for activity/health floor)
- [x] Confidence tiers: none / very\_low / low / medium
- [x] Portfolio net worth card on dashboard
- [x] Valuation column in repos table
- [x] 30 unit tests

### Phase 16 — Portfolio Analytics Trends
- [ ] Line chart on Analytics page: avg health over time — waiting for 30+ days of snapshots

### Phase 17 — Goal Tracking
- [x] `goals` table: type (mrr / health\_avg / repos\_live / revenue\_repos / custom), target, deadline
- [x] Auto-progress computed from live data on every sync
- [x] GoalsCard on dashboard — progress bars, deadline countdown, On Track / Behind
- [x] GoalManager in Settings

### Phase 18 — Portfolio Resume & Shareable Reports
- [x] `/u/[username]/resume` — print-friendly portfolio
- [x] Dynamic OG image for `/u/[username]`
- [x] `/u/[username]/report/[YYYY-q#]` — quarterly report with AI commentary

### Phase 21 — Purpose Field & Focus Projects
- [x] `purpose` enum: Revenue / Learning / Consulting / Experiment / Open Source / Client Work / Portfolio / Infrastructure
- [x] Purpose selector on repo detail Overview tab
- [x] `is_focused` boolean — focus toggle on repo detail
- [x] Purpose, Focus, Archive Score columns in repos table (hidden by default, toggle via Columns menu)

### Phase 22 — Archive Candidates
- [x] `archive_score` (0–100) — inactivity, zero revenue, no deployment, low health, low opportunity
- [x] Archive Candidates card on dashboard — one-click lifecycle transition to Sunsetting


### Phase 23 — Itemized Cost Tracking
- [x] `cost_items` jsonb on repositories — `[{ label, amount }]` line items
- [x] Cost line-item editor on Revenue tab — add/remove/edit, total auto-summed
- [x] Per-repo P&L summary on Revenue tab: revenue, itemized costs, monthly + annual profit, margin
- [ ] Portfolio cost breakdown on dashboard (by label)

### Phase 24 — Weekly CEO Report
- [x] `ceo_report` jsonb on `digests` table
- [x] Sections: Portfolio Summary, Biggest Wins, Biggest Risks, Recommended Focus
- [x] Generated alongside digest + advisor every Monday (claude-haiku, cached prompt)
- [x] Collapsible CEO Report card on dashboard with regenerate button

### Phase 25 — Time Allocation Recommendations
- [x] Ranks repos by projected value delta — health gap × opportunity gap, revenue + focus multipliers
- [x] "Best Use of Your Time" card on dashboard — top 3 repos with impact estimate
- [x] Strong archive candidates (score ≥ 70) excluded from ranking
- [x] Hours-available input in Settings (Goals section) — configures time allocation

### Phase 26 — Opportunity vs Effort Matrix
- [x] `estimated_effort` enum on repositories: low / medium / high
- [x] Effort selector on repo detail Overview tab
- [x] 2×2 quadrant view on Analytics page: Quick Win / Invest / Fill-In / Deprioritize
- [x] Repos listed by opportunity score within each quadrant

### Phase 27 — Idea Graveyard
- [x] `abandonment_reason` text field on repositories
- [x] Prompt shown automatically when lifecycle → Sunsetting or Archived
- [x] `/repos/graveyard` page in sidebar — archived repos with reason badges
- [x] Advisor prompt includes graveyard context — warns when new action resembles abandoned idea

### Phase 28 — Personal Changelog
- [x] `portfolio_events` table — repo created, archived, MRR changed, health milestone, first revenue
- [x] Events auto-captured during sync: new repos, archives, MRR changes ≥$10, health milestones (70/80/90)
- [x] Manual milestone entries (free-text) via `/feed` Milestones tab
- [x] `/feed` Milestones tab with timeline view, month grouping, delete for manual entries
- [x] Annual markdown export — `/api/changelog/export?year=YYYY`

### Phase 29 — Portfolio Dependency Map
- [x] Scanner returns `packageName` + all dep names from `package.json`
- [x] `internal_deps` jsonb on `repository_metrics` — synced after full portfolio scan
- [x] Force-directed SVG graph on Analytics page — hover to highlight connections
- [x] Cascade risk alert in Feed: warns when a depended-upon repo has health < 60

### Phase 30 — Portfolio Score
- [x] `portfolio_score_history` table — daily snapshot, idempotent via unique `(userId, recordedDate)`
- [x] `calculatePortfolioScore()` — 4-component formula: Health 40%, Activity 25%, Revenue 25%, Diversity 10%
- [x] Snapshotted after every sync alongside `health_score_history`
- [x] `PortfolioScoreCard` on dashboard — circular ring gauge, grade (A–F), component bars, weekly delta badge

### Phase 31 — Weekly Diff Card
- [x] `getWeeklyDiff()` server action — computes from `health_score_history`, `portfolio_events`, `security_findings`
- [x] Top health improver and top decliner (min ±3pt delta to avoid noise)
- [x] New repos, archived repos, MRR changes, new critical/high security alerts
- [x] `WeeklyDiffCard` on dashboard — hidden when nothing happened this week

### Phase 43 — Ruthless Polish

#### 43a — AI Card Consolidation
- [x] Removed `WeeklyBriefingCard` from dashboard — superseded by CEO Report
- [x] Merged `TimeAllocationCard` into `AdvisorCard` as "Best use of your time" sub-section
- [x] Moved `OpportunityCostCard` off dashboard → Feed page (weekly retrospective, not persistent signal)
- [x] Net: 5 AI cards → 2 core cards (Advisor + CEO Report) + standalone Simulation

#### 43b — Phase 16: Portfolio Health Trend Line Chart
- [x] `getPortfolioHealthTrend(userId)` in `history.ts` — groups health_score_history by date, avg across all user repos
- [x] `HealthTrendLineChart` Recharts line chart — 3 lines (health/security/activity), 30-day window
- [x] Added to Analytics page above existing snapshot bar chart
- [x] Graceful empty state when < 3 data points ("Collecting data...")

#### 43c — Ship It Nudge (Phase 32)
- [x] `getShipItWarnings()` — focused repos with weeklyCommits = 0 and lastPush > 7 days
- [x] `ShipItCard` in Status zone — shows repo, days since commit, opp score, "Ship it →" link
- [x] Snooze stored in localStorage, expires after 3 days; max 3 warnings shown

#### 43d — GitHub Profile README Generator
- [x] `/api/profile-readme/[username]` — returns raw markdown using showcase scoring + portfolio stats
- [x] `ProfileReadmeGenerator` in Settings (visible when public profile enabled)
- [x] Live preview (fetched client-side on mount), copy button, refresh, GitHub link

#### 43e — Dashboard Hierarchy
- [x] Three visual zones with `SectionLabel` dividers: STATUS / INTELLIGENCE / PLANNING
- [x] Ship It Nudge in Status zone; Simulation + Opportunity + Archive in Planning zone
- [x] CEO Report full-width in Intelligence zone (was crammed into 2-col grid)

### Phase 32 — Ship It Nudge
- [x] Shipped in Phase 43c

### Phase 33 — Dependency Graph: Shared External Deps
- [ ] Extend dep graph to show repos that share prominent external packages (drizzle-orm, openai, etc.)
- [ ] Shared deps shown as edge labels; more immediately useful than internal deps

### Phase 34 — Portfolio Concentration Risk
- [x] Revenue concentration: % of total MRR tied to top repo, risk level (low/medium/high)
- [x] Stack concentration: dominant frontend framework across active repos
- [x] `ConcentrationRiskCard` on dashboard — bar chart, color-coded risk, single-failure warning
- [x] Pure computation from existing data — no new DB queries

### Phase 35 — One-Click Archive Pipeline
- [x] "Archive on GitHub" button on graveyard page for repos not yet archived on GitHub
- [x] `archiveRepoOnGitHub()` calls `PATCH /repos/{owner}/{repo}` via Octokit, sets read-only
- [x] Updates `isArchived` + `lifecycleStatus = 'archived'` in DB, writes `portfolio_events` entry
- [x] Shows "✓ On GitHub" badge for repos already archived; button collapses to confirmation on success

### Phase 36 — Portfolio Simulation Engine
- [x] "Plan My Week" card on dashboard — given N hours + goal type, models optimal allocation
- [x] Goal types: max opportunity, max revenue, max health
- [x] Uses pre-computed opportunity score deltas (same as Advisor) + effort estimates as inputs
- [x] Output: ranked allocation table with estimated hours, opportunity delta, projected MRR
- [x] Greedy algorithm: highest ROI-per-hour, one action per repo, fits within budget
- [x] Portfolio score projection: estimated new score if all actions completed

### Phase 37 — Stripe / Revenue API Integration
- [x] Stripe restricted API key stored on user record in Settings → Revenue Integration
- [x] Fetches all active subscriptions, calculates MRR per product (handles yearly → monthly normalisation)
- [x] Product → repo mapping UI in Settings
- [x] "Sync MRR" button + runs automatically on every daily cron sync
- [x] No SDK dependency — plain fetch against Stripe REST API with pagination

### Phase 38 — MCP Server (IDE Context Integration)
- [x] `mcp/server.ts` — stdio MCP server, runs locally via `npx tsx`
- [x] Tools: `get_portfolio_summary`, `get_repo_context`, `get_portfolio_warnings`, `get_top_opportunities`, `get_active_goals`
- [x] Queries Neon DB directly with `DATABASE_URL` + `MCP_USER_ID` env vars
- [x] `~/.claude/claude.json` configured and ready — restart Claude Code to activate
- [x] `mcp/README.md` with setup instructions and usage examples

### Phase 41 — GitHub Profile Optimizer
- [x] `calculateShowcaseScore()` — health (40%), stars (20%), focus (15%), deployment (15%), purpose (10%)
- [x] "GitHub Profile" card on dashboard — top 6 repos to pin, ranked by showcase score
- [x] Skips private/archived/sunsetting repos; purpose bonus for Portfolio/Open Source/Revenue
- [x] Links to each repo + direct link to GitHub profile

### Phase 42 — Bulk Triage Mode
- [x] `/repos/triage` in sidebar — work through all active repos systematically
- [x] Repos ordered by archive score DESC (most archive-worthy first)
- [x] Per-repo card: name, health badge, description, last push, archive risk level
- [x] One-click actions: Keep / Sunset / Archive / Skip with immediate DB save
- [x] Keyboard shortcuts: K = Keep, S = Sunset, A = Archive, Space = Skip, ← = Previous
- [x] Progress bar + "X remaining" counter
- [x] End screen: summary of kept / sunsetted / archived / skipped counts

### Phase 44 — Bring Your Own LLM Key
- [x] `llmProvider` + `llmApiKey` columns on users table
- [x] `LLMAdapter` interface with `generate({ system, user, fast, maxTokens, cacheSystem })`
- [x] Anthropic adapter (preserves prompt caching) + OpenAI adapter (gpt-4o-mini / gpt-4o)
- [x] `getLLMAdapter(userId)` factory — user key → app env var fallback → error if neither
- [x] All 5 AI modules (digest, advisor, ceo-report, analysis, summary) + NL query updated
- [x] Settings → AI Provider: Claude/OpenAI selector, key input, test-on-save, remove button
- [x] Prompts unchanged — transfer cleanly between providers

### Phase 39 — Opportunity Cost Tracker
- [x] `computeOpportunityCost()` — compares repos with weeklyCommits > 0 vs highest-value untouched repos
- [x] `OpportunityCostCard` on dashboard — shows what you worked on, what you missed, score delta
- [x] Only surfaces when delta ≥ 10 pts (suppressed when the gap is noise)
- [x] Infers time investment from `weeklyCommits` field synced from GitHub

### Phase 45 — Agentic Coding Context (MCP Expansion)
- [x] `get_coding_brief(repo_name)` — health, lifecycle, tech stack, advisor actions, tech debt, security, recent session history; ready to paste at session start so agent never starts cold
- [x] `get_next_action()` — single highest-ROI task from advisor + opportunity scores; skips Reference/Infrastructure/sunsetting repos; falls back to highest-opp repo if no advisor data
- [x] `log_session_complete(repo_name, summary, agent_name)` — writes `session_complete` portfolio_events entry with agent metadata; future coding briefs include session history for agent continuity
- [x] `mcp/brief.ts` — pure formatting helpers extracted for testability
- [x] 22 unit tests covering health formatting, last-push display, actionable-repo filtering, action picking

### Phase 46 — RepoHQ × AI-DevOps Nexus Integration (Personal First)
- [x] Phase A: "Queue" button on advisor actions → POST to Nexus `/internal/agent-tasks`; stage-based UI (queued → preparing → running → PR ready → merged/failed/timed_out); 15-min timeout; substantial effort security gate
- [x] Phase A.5: Agent ROI & Accuracy Tracking — predictedDelta vs actualDelta, `/agent-performance` page, accuracy notice for <5 merges
- [x] Phase B: Nexus agent reads `get_coding_brief` via RepoHQ MCP before execution (brief-fetcher queries Neon directly)
- [x] Phase C: gstack skills as `AGENT_EXECUTION_COMMAND` per risk tier — `scripts/gstack-ship.sh` (Tier 2), `scripts/gstack-investigate.sh` (Tier 3)
- [x] Phase D-infra: Webhook loop — `agent_pr_created`, `agent_pr_merged`, `agent_execution_failed` events; auto-resync on merge via `after()`; status polling API
- [x] Phase D: Full agent observability — PR status badges on repo list, agent events in Portfolio Feed, Agent History tab on repo detail, AgentStatsBlock on Analytics, AgentImpactCard on Dashboard
- [ ] Phase E: Auto-queue + batch approval (unlock after 6 months + 80% accuracy)

### Phase 47 — Agent Observability & PR Tracking ✅
- [x] Repo list: "PR open →" badge on repos with an active agent PR (prevents double-queueing)
- [x] Repo detail: "Agent" tab — all tasks queued, PR status + links, predicted vs actual delta per run
- [x] Portfolio Feed: agent events appear inline (PR opened, PR merged with actual delta, execution failed)
- [x] Analytics: AgentStatsBlock — tasks queued, PRs created/merged/failed, success rate, total score gained
- [x] Dashboard: AgentImpactCard — pts gained from agent PRs this month (appears once ≥1 PR merged)

### Phase 48 — PR Merge Detection via Cron Poll
- [x] `checkMergedAgentPRs(userId)` — polls GitHub API for open agent PRs, detects merges, writes `agent_pr_merged` event with `healthBefore`
- [x] `resolveActualDeltas(userId)` — after sync, computes `actualDelta = healthAfter - healthBefore` and updates event metadata
- [x] Wired into `/api/cron/sync` — runs before full sync (detect + record healthBefore), resolves deltas after sync completes
- [ ] Phase E: Upgrade to GitHub App real-time webhooks (see Distribution Roadmap below)

See [docs/agentic-execution-prd.md](agentic-execution-prd.md) for full PRD, architecture, and risk analysis.

---

## Intelligence & Agent Quality Roadmap

The next layer of value: making the system smarter for both humans and agents the longer it runs.

### Phase 49 — Push Notifications ✅
- [x] In-app notification bell in topbar: unread badge, Sheet panel, mark-read, 2-minute polling
- [x] `notifications` table + `notificationWebhookUrl` + `healthAlertThreshold` on users schema
- [x] `dispatcher.ts`: `createNotification()`, `checkHealthThresholdAlerts()` — no-spam (7-day window per repo)
- [x] `webhook.ts`: pure `sendWebhook()` (extracted for testability; works with Slack, Make, Zapier, any HTTP endpoint)
- [x] Notification settings card in /settings: webhook URL + test button + health threshold config
- [x] Cron sync calls `checkHealthThresholdAlerts()` after health snapshot
- [x] Webhook handler dispatches `agent_pr_ready` and `agent_failed` notifications via `after()`
- [ ] Email digest on critical events (future — needs email provider)
- [ ] Weekly briefing email (future — extend existing digest cron)

### Phase 50 — Active Work Signal in MCP ✅
- [x] `get_active_work(repo_name?)` MCP tool — returns open agent PRs + safe-to-start flag, portfolio-wide or per-repo
- [x] `getOpenAgentPRMap()` shared helper — used by `get_active_work`, `get_next_action`, `get_coding_brief`
- [x] `get_next_action()` skips repos with open agent PRs (collision prevention at the MCP level)
- [x] `get_coding_brief()` gains "In Flight" section showing active PR URL + task ID if present

### Phase 51 — Attempt Log & Failure Feedback ✅
- [x] `log_attempt(repo_name, action, outcome, reason)` MCP tool — writes `agent_attempt` to `portfolio_events`
- [x] `getDeadEndActions()` helper — identifies (repo, action) combos with 2+ failures
- [x] `get_next_action()` skips dead-end actions (advisor stops recommending known-failed approaches)
- [x] `get_coding_brief()` gains "Recent Attempts" section: outcome emoji, reason, failure warning at 2+ failures
- [x] Agent History tab on repo detail now includes `agent_attempt` events with colour-coded outcome badges
- [ ] Closed/rejected PR detection (future — needs GitHub webhook or polling for PR close events)

### Phase 52 — Advisor Learning Loop
The longer the system runs, the better its recommendations should get.
- [ ] Per-action-type accuracy tracking: success rate broken out by `impactType` (security, docs, deps, activity) — visible on `/agent-performance`
- [ ] Predicted vs actual delta accuracy score per action type: if "add docs" consistently predicts +8 but delivers +2, show the calibration gap
- [ ] Advisor prompt injection: low-accuracy action types get a confidence caveat ("documentation tasks have 41% accuracy — review carefully before queuing")
- [ ] Repo-level failure memory: advisor notes if a repo has had 2+ failed agent runs and downgrades its recommendation priority until a human intervenes
- [ ] Monthly accuracy report: email/digest summary of advisor calibration, which task types are reliable, which aren't

### Phase 40 — Open-Source Template / Deploy-to-Vercel
- [x] README rewritten — Deploy to Vercel button, full setup guide (8 steps), all services documented
- [x] Local dev OAuth app separation documented (production vs localhost)
- [x] MCP server setup instructions in mcp/README.md
- [x] Stripe restricted key setup guide included
- [x] `.env.example` complete with all 7 required variables

---

## Distribution Roadmap

Features required to open RepoHQ to other users. Tracked separately because they each touch auth, data isolation, billing, or GitHub platform constraints.

### D1 — GitHub App (real-time webhooks + PR merge detection)
- Replace polling-based PR merge detection with real-time `pull_request` webhooks
- GitHub App installation flow per user (separate from OAuth App)
- Handles: PR merge events, push events for instant sync, security alerts
- Required for: sub-minute merge detection, multi-user scale (each user installs the app)
- **Blocker for open distribution**: OAuth App token approach doesn't scale; GitHub App is the right model for SaaS

### D2 — Multi-tenant data isolation
- Row-level security audit: every query scoped to `userId`; automated check in CI
- Rate limiting per user on AI endpoints and sync crons
- Webhook secret scoped per user (currently global env var)
- Admin dashboard: user list, sync status, error rates

### D3 — Self-serve onboarding
- OAuth sign-up flow (already exists via Auth.js) → automated first sync → guided setup
- Empty-state walk-through (no repos → sync button → first health score)
- Email welcome + sync completion notification

### D4 — Billing
- Stripe subscription gate for AI features (advisor, MCP, BYOK settings)
- Free tier: sync + health scores only; Paid: AI advisor, agent execution, BYOK
- Usage metering for agent execution costs

### D5 — BYOK for agent execution
- Allow users to connect their own Nexus instance (or a hosted Nexus endpoint)
- Currently hard-coded to owner's Render deployment; needs per-user `NEXUS_API_URL` + `NEXUS_API_TOKEN` in settings

---

## Deferred

| Feature | Reason |
|---------|--------|
| Vercel deployment history (logs, preview URLs) | Needs `VERCEL_TOKEN` billing scope |
| Netlify / Render / Railway API integrations | Needs per-platform tokens |
| Anthropic / OpenAI / AWS cost tracking | No per-project tracking in those APIs |
| GitHub Webhook real-time sync | Requires GitHub App (separate from OAuth App) |
| Incremental sync | Nice-to-have for portfolios > 200 repos |
| Phase 16 trend lines | Accumulating automatically — will ship after ~30 daily syncs |
| Slack / email digest delivery | Pipe Monday digest to Slack or email so it's seen without logging in |
| Founder Memory Layer | Vector DB + retrieval pipeline — high complexity, years to pay off |
| Codebase Cross-Pollinator | pgvector embeddings across repos — interesting but high noise-to-signal |
| Burnout Predictor | Insufficient data for one person's commit history |
| Auto PR Generation | Requires GitHub App (separate OAuth flow) |
| Weekly CEO Conversation Mode | Interesting but requires real-time chat UI infrastructure |
| Job Market / Tech Demand Scoring | Interesting career-angle feature; low priority for pure portfolio management |

---

## Infrastructure

**GitHub Actions (current — primary cron trigger):**
- Sync: every 6 hours
- Security: daily at 03:00 UTC
- Deployments: every 12 hours
- AI summaries: Sundays 05:00 UTC
- Digest + Advisor + CEO Report: Mondays 06:00 UTC

**Vercel crons (Sunday-only fallback):**

| Endpoint | Time (UTC) | What it does |
|----------|-----------|-------------|
| `/api/cron/sync` | 02:00 daily | Full sync + health snapshot + goal refresh |
| `/api/cron/security` | 03:00 daily | Dependabot + secret scanning |
| `/api/cron/deployments` | 04:00 daily | Uptime checks |
| `/api/cron/ai-summary` | 05:00 Sunday | Regenerate AI repo summaries |
| `/api/cron/digest` | 06:00 Monday | Digest + Advisor + CEO Report |
