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

See [docs/architecture.md](architecture.md) for risk tiers, safety gates, success metrics, and competitive context. See [docs/agentic-full-flow.md](agentic-full-flow.md) for mermaid architecture and sequence diagrams.

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

### Phase 52 — Advisor Learning Loop ✅
The longer the system runs, the better its recommendations get. Every merged agent PR is a data point; the advisor now reads its own track record before generating recommendations.

- [x] **52-A: Data fixes** — `impactType` now stored in `agent_execution_failed` events; `deltaConfidence: 'high'|'low'` flag on resolved deltas (|Δ| > 20 pts = low confidence, likely other factors)
- [x] **52-B: Accuracy computation** — `src/lib/actions/advisor-accuracy.ts`: `getAccuracyByImpactType()`, `getRepoAccuracy()`, `getDowngradedRepos()` — computed from `portfolio_events`, no new table; time-decay (last 30d × 2); risk-adjusted suppress thresholds per impactType; `src/lib/actions/advisor-accuracy-utils.ts` — pure functions safe for unit tests
- [x] **52-C: Advisor prompt injection** — accuracy summary table injected into user message (preserves system prompt cache); new rule: Claude adds confidence caveat to reasoning on <50% success rate actions; downgraded repos listed
- [x] **52-D: UI** — `AccuracyTable` component on `/agent-performance` replacing "X of 5 needed" placeholder; per-row signal labels (Strong/Mixed/Weak/Building); trend arrows (↑↓) from time-decayed rate; confidence emoji badges (🟢🟡🔴⚪) on each AdvisorCard action
- [x] **52-E: MCP + digest** — `get_accuracy_report()` MCP tool with full calibration table + downgraded repos; `get_next_action()` now includes confidence line per impactType; monthly digest (first Monday) auto-includes accuracy summary in stored content

### Phase 53 — Auto-Dispatch (Agentic Workforce) ✅
Wake up Monday morning with PRs ready to review — no clicking required.

- [x] Schema: `autoDispatchEnabled`, `autoDispatchEffortGate`, `autoDispatchMaxPerRun`, `autoDispatchSkipSecurity`, `autoDispatchAccuracyThreshold` on `users`
- [x] `queueAdvisorActionForUser(userId, action)` — session-less queue function safe for cron context
- [x] `autoDispatchAdvisorActions(userId, advisor, settings, accuracyStats)` — filter pipeline: effort gate → security gate → accuracy gate → lifecycle guard → queue up to max
- [x] Digest cron hook: after `generateAdvisor()`, auto-dispatches eligible actions if `autoDispatchEnabled`
- [x] Settings UI card: toggle, effort gate (quick / quick+medium / all), max per week, skip security, accuracy threshold
- [x] `autoDispatchAccuracyThreshold`: only dispatches action types with ≥N% success rate (0 = always dispatch); skips if insufficient data (not enough signal yet)
- [x] 14 unit tests for filter logic covering effort/security/accuracy/maxPerRun rules

### Phase 54 — Token Efficiency ✅
Prevents redundant DB queries and token spend as agent volume grows.

- [x] **T1: `cachedBrief`** — `repositories.cached_brief JSONB`; written by `get_coding_brief` after generation, cleared on each sync; subsequent calls within 6h served from cache with 0 DB queries (saves ~25K tokens at 100 agents)
- [x] **T2: `advisorRepoSnapshot`** — `digests.advisor_repo_snapshot JSONB`; stores the compiled repo lines sent to Claude; reused for 23h then recomputed; invalidated on sync (saves ~2,500 tokens per advisor run)
- [ ] **T3: Brief freshness signal** (`briefStaleAt` timestamp, event-driven) — future
- [ ] **T4: Context compression** (distil sessions+attempts weekly via Sunday cron) — future
- [ ] **T5: pgvector** (semantic repo matching, outcome clustering) — future when 50+ repos with history

### Phase 55 — CI Feedback Loop (Self-Correcting Agents)

The last-mile gap: once an agent opens a PR, CI can still fail — and today the system has no awareness of it. A human has to intervene. This phase closes the loop so the agent can detect CI failures, understand the error, and push a fix commit to the same branch automatically.

**The flow:**
```
PR created → CI runs →
  success → merge (existing loop) ✓
  failure → detect → fetch error output → re-queue on same branch → fix commit → CI re-runs
            (after 3 failures → escalate to human)
```

- [ ] `checkCIFailuresOnAgentPRs(userId)` — polls GitHub API (`/commits/{sha}/check-runs`) for failed CI on open agent PRs; runs in the 6h sync cron alongside `checkMergedAgentPRs()`
- [ ] `agent_ci_failed` event type — stores: `{ prUrl, branchName, checkName, errorSummary, attempt, sha }` in `portfolio_events`; new lifecycle stage `ci_failing`
- [ ] Auto-requeue with error context — creates a new Nexus task: objective = "Fix CI failure on PR #{N}: {errorSummary}", `contextNotes.existingBranch` = PR head branch, `contextNotes.prNumber`, `contextNotes.ciError` = truncated error output
- [ ] Nexus: resume-on-branch mode — agent-runner checks `contextNotes.existingBranch`; if set, fetches and checks out that branch instead of creating a new `nexus/auto-*` branch
- [ ] Retry guard — max 3 CI fix attempts per PR; on 4th failure writes `agent_needs_human` event and dispatches notification: "Agent PR #{N} has failing CI after 3 fix attempts — human review needed"
- [ ] QueueButton: `ci_failing` stage shown in the lifecycle UI (yellow, links to the failed check)
- [ ] Agent History tab: `agent_ci_failed` events shown inline with error summary and attempt count

### Phase 40 — Open-Source Template / Deploy-to-Vercel
- [x] README rewritten — Deploy to Vercel button, full setup guide (8 steps), all services documented
- [x] Local dev OAuth app separation documented (production vs localhost)
- [x] MCP server setup instructions in mcp/README.md
- [x] Stripe restricted key setup guide included
- [x] `.env.example` complete with all required variables (including `ENCRYPTION_KEY` added in Phase 58-A)

---

## gstack Integration Roadmap

[gstack](https://garryslist.org) is a Claude Code skill framework that provides specialised agent workflows (`/ship`, `/investigate`, `/qa`, etc.) with multi-turn planning, checkpoint mode, and a learnings system that persists institutional knowledge across sessions.

### Current State — "gstack-inspired" wrappers ✅

The agentic execution pipeline uses two shell scripts in the AI-Took-My-Job repo (`scripts/gstack-ship.sh`, `scripts/gstack-investigate.sh`) as the `AGENT_EXECUTION_COMMAND`. These:

- Call **Claude Code CLI directly** (`npx claude --dangerously-skip-permissions --print`) — not gstack skills
- Are named after gstack's `/ship` and `/investigate` skill concepts
- Inject RepoHQ context (health, lifecycle, advisor brief) from `.nexus/context.json` into the agent prompt
- Write `.nexus/output.json` in the format Nexus expects to promote the PR
- Run in **non-interactive `--print` mode** — one-shot execution, no multi-turn planning

The scripts are a functional bridge that proved the end-to-end flow works. True gstack integration replaces these with the full skill workflows.

### G1 — True gstack Skill Invocation

Replace the bare `claude --print` calls with actual gstack skill entry points:

- `scripts/gstack-ship.sh` → invoke `/ship` skill with the RepoHQ brief pre-loaded as session context
- `scripts/gstack-investigate.sh` → invoke `/investigate` skill with the RepoHQ brief + security findings
- Switch from `--print` (non-interactive one-shot) to full interactive gstack session mode
- gstack's multi-turn planning phase means the agent plans before executing — higher success rate on complex tasks

### G2 — Task-Type Routing by impactType

Currently `AGENT_EXECUTION_COMMAND` is a single env var — one script for all tasks. Route by `impactType` from the advisor action:

| impactType | Script | gstack Skill |
|------------|--------|-------------|
| `security` | `gstack-investigate.sh` | `/investigate` |
| `health` / `opportunity` | `gstack-ship.sh` | `/ship` |
| `revenue` | `gstack-ship.sh` | `/ship` |

The Nexus worker already passes `impactType` in `contextNotes` — routing just needs to read it before spawning the command.

### G1 — Real gstack Skill Invocation ✅
- `gstack-investigate.sh`: now invokes `claude /investigate` with `OPENCLAW_SESSION=true` + `SPAWNED_SESSION=true` — real multi-turn skill, not bare `claude --print`
- `gstack-ship.sh`: same upgrade to `claude /ship`
- `skillName` added to contextNotes in all task queuing so Nexus can route to the correct script
- Both scripts merge RepoHQ brief into the task prompt before invoking the skill

### G2 — UI Skill Launcher + MCP Tool ✅
- `GstackSkillLauncher` component on repo Agent tab — three cards: `/investigate`, `/health`, `/ship`
- Smart objective pre-fill from repo state (failing build → investigate build, security alerts → investigate CVE, advisor action → ship it)
- `queueGstackSkill(repoId, skill, objective)` server action — same lifecycle guard as advisor queueing
- `queue_gstack_skill(repo_name, skill, objective?)` MCP tool — AI agents can trigger skills from Claude Code context; tracked by `get_active_work()` naturally
- `agent_skill_report` event type — investigation findings stored in `portfolio_events` and displayed inline in Agent History with bullet list

### G3 — gstack Learnings Persistence ✅
- Both scripts call `gstack-learnings-search --limit 5` before the skill runs and append results to the task prompt — agents start each session knowing what already failed
- `/investigate` calls `gstack-learnings-log` after completion to persist key findings for future runs
- Slug computed per-repo via `gstack-slug`; learnings stored in `~/.gstack/projects/{slug}/learnings.jsonl`

### G4 — Checkpoint Mode Integration ✅
- Both scripts call `gstack-config set checkpoint_mode continuous` before invoking the skill
- WIP commits auto-created at each step; if Nexus times out, a re-run resumes from last WIP commit
- Reduces "timed out after 15 min" events significantly for large tasks

### G5 — MCP + gstack Session Synergy ✅
- All scripts write the RepoHQ brief (from `context.json`) directly into `CLAUDE.md` in the worktree between sentinel comments (`<!-- repohq-brief-start -->` / `<!-- repohq-brief-end -->`)
- gstack reads `CLAUDE.md` natively as project context — brief appears automatically in every tool call, no manual prompt injection needed
- Prior RepoHQ sections stripped and re-injected on each run so it stays fresh

### G6 — Dynamic Skill Routing in Nexus Worker ✅
- `resolveSkillCommand(skillName, fallback)` in `agent-runner.ts` reads `contextNotes.skillName` and maps to the correct script: `investigate→gstack-investigate.sh`, `ship→gstack-ship.sh`, `health→gstack-health.sh`
- `GSTACK_SCRIPTS_DIR` env var overrides the script directory (defaults to dirname of `AGENT_EXECUTION_COMMAND`)
- `skillName` now included in all task queuing: advisor actions, auto-dispatch, gstack UI launcher, MCP tool
- `gstack-health.sh` added as a new script — wraps `/health` skill, produces Nexus output.json contract

### G7 — Full Lifecycle Skill Integration ✅
All 9 portfolio-relevant gstack skills wired end-to-end.

- [x] 6 new Nexus scripts: `gstack-review.sh`, `gstack-qa.sh`, `gstack-qa-only.sh`, `gstack-retro.sh`, `gstack-canary.sh`, `gstack-document-release.sh` — same G1-G5 pattern (OPENCLAW_SESSION, learnings, CLAUDE.md brief, checkpoint mode)
- [x] `GstackSkill` type + `SKILL_META` extracted to `nexus-utils.ts` (no auth/DB imports — unit-test safe); `nexus.ts` re-exports
- [x] `SKILL_DEFAULTS` extended for all 9 skills; `queueGstackSkill()` works generically
- [x] Repo Agent tab: lifecycle-phased skill menu (5 sections: Understand / Build Quality / Ship / Monitor / Reflect), 9 skills with type badges (Analyze+Fix / Report only / Creates PR), collapsible sections with `localStorage` persistence
- [x] `/canary` hidden when repo has no `homepage` — shows "Needs deployment URL" notice instead
- [x] `SkillReportFindings` component: full expandable findings (no truncation), "Show N more" toggle, `getSuggestedActions()` infers `/ship` or `/investigate` from finding text, one-click queue buttons per suggestion
- [x] `agent_skill_report` event: Nexus worker fires webhook on `outcome: no-changes` + `skillName`; `report_ready` terminal stage stops UI polling
- [x] Dashboard: `ActiveAgentsCard` in Status section — shows in-flight agent tasks, hidden when nothing running
- [x] `get_skill_history(repo_name, skill?)` MCP tool — returns recent skill runs with findings
- [x] `queue_gstack_skill` MCP tool extended to all 9 skills with per-skill default objectives
- [x] Schema: `autoRunHealthWeekly`, `autoRunRetroWeekly`, `autoRunCanaryOnDeploy` on users
- [x] Digest cron: auto-queues `/retro` Monday + `/health` Sunday on focused repos when toggles enabled
- [x] Settings: "Scheduled Skills" section in Auto-Dispatch card with three toggles
- [x] 30 new unit tests (SKILL_META completeness, getSuggestedActions inference, canary visibility, active agent derivation)
- [x] Playwright tests: phase labels, type badges, findings expansion, actionable items, Active Agents card
- [x] Integration test scripts: `gstack-review-check.sh`, `gstack-qa-only-check.sh`, `gstack-retro-check.sh`

### Phase 57 — Gstack Self-Improvement Loop ✅
RepoHQ now monitors and improves itself without any human intervention, scoped to the RepoHQ repo.

**The loop:**
```
Daily 07:00 UTC cron
  → /api/cron/gstack-self finds "RepoHQ" in tracked repos
  → queues /health + /qa-only scans to Nexus (parallel)
  → Nexus runs gstack skills on RepoHQ codebase/site
  → /api/webhooks/agent-events receives agent_skill_report
  → findings parsed → up to 3 fix tasks auto-queued back to Nexus
  → fix PRs created → merged → resync → health score improves
  → next daily cycle starts with a higher baseline
```

- [x] `queueGstackSelfScan(userId, repoId, repoFullName, skill)` — in `nexus.ts`; queues `health`/`qa-only` directly to Nexus with `executionMode: 'investigate'`, bypassing the advisor flow; lifecycle-guarded
- [x] `/api/cron/gstack-self` — new cron route; finds tracked repo matching `GSTACK_SELF_REPO_NAME` env (default `"RepoHQ"`); queues both skills in parallel per user
- [x] Agent events webhook self-improvement branch — when `agent_skill_report` arrives with `source === 'gstack-self-scan'` and findings exist, converts up to 3 findings into `AdvisorAction`s and queues fix tasks via `after()` (non-blocking); security/health/opportunity classified by finding text
- [x] Loop prevention — fix tasks dispatched from scan reports do not re-trigger further scans; max 3 fix tasks per cycle; lifecycle guard prevents parallel duplicates
- [x] `vercel.json` — `0 7 * * *` schedule added (daily at 07:00 UTC)

### G8 — OpenClaw Orchestration (Fully Agentic Flow)

The vision: RepoHQ stops being a dispatch system and becomes an **AI workforce coordinator**. Instead of a human clicking "Queue" and one agent running on one repo, OpenClaw orchestrates multiple agents in parallel — sharing context, chaining skills, and re-prioritizing in real-time.

**The architecture shift:**

Today:
```
Monday cron → advisor generates actions → auto-dispatch queues them →
Nexus runs tasks one at a time → agents are isolated, no shared context
```

With OpenClaw:
```
Monday cron → advisor generates priority queue →
OpenClaw spawns N agents in parallel, each on a different repo/skill →
  Agent A finds an issue → OpenClaw injects finding into Agent B's context
  Agent C finishes /health → OpenClaw auto-chains /ship if findings warrant it →
  Agent D finishes → result feeds back into advisor priority queue →
Human reviews outcomes, not individual tasks
```

**Planned items:**

- [ ] **Parallel execution**: Replace Nexus single-task dispatch with OpenClaw multi-agent spawn — N agents across N repos simultaneously, bounded by `autoDispatchMaxPerRun`
- [ ] **Skill chaining**: `/health` findings with TypeScript errors → auto-spawn `/ship "Fix TypeScript errors"` without human click; `/investigate` findings with security issue → auto-spawn `/ship` fix; chainable up to 2 hops to prevent loops
- [ ] **Cross-repo context sharing**: OpenClaw passes findings from Agent A (e.g. "repo uses deprecated auth pattern") into Agent B's CLAUDE.md brief when B is working on a related repo (detected via `internal_deps` dependency map)
- [ ] **Live orchestrator on dashboard**: RepoHQ advisor acts as the OpenClaw task planner — continuously re-ranks the queue as agents report back; "Orchestrator running" status in Active Agents card
- [ ] **Human approval gate**: Before OpenClaw auto-chains a skill, a lightweight approval toast appears in the dashboard — "Agent found TypeScript errors in open-travel. Run /ship to fix? [Approve] [Skip]" — with 10-min auto-approve if `autoDispatchEnabled`
- [ ] **Termination conditions**: OpenClaw stops when: (a) all tasks complete, (b) 3 consecutive chained failures, (c) a `/investigate` returns `security` severity finding requiring human review, or (d) manual stop from dashboard
- [ ] **Session history in briefs**: OpenClaw surfaces what other agents learned this session in each new agent's CLAUDE.md brief — "Agent working on Open-Travel found: dead code in utils/format.ts. Review before writing similar utilities."
- [ ] **Prerequisite**: Phase 55 (CI feedback loop) should ship first — OpenClaw chaining without CI awareness would create PRs that fail silently

**Why OpenClaw over a custom orchestrator:** `OPENCLAW_SESSION=true` is already in every gstack script. The infrastructure recognizes spawned sessions and suppresses interactive prompts. OpenClaw's skill coordination layer is built for exactly this pattern — building a custom orchestrator would replicate it. The integration point is replacing the Nexus worker's single-task spawn with an OpenClaw session that manages the task graph.

### Phase 56 — G7 UX & Agent Experience Improvements

Following the architecture review of G7, three categories of improvements across user control, agent intelligence, and code quality.

#### 56-A User Control
- [x] **Auto tag in Agent History** — `source` field already stored per queued event (`repohq-advisor`, `repohq-gstack-ui`, `repohq-auto-dispatch`). Now surfaced as a small "Auto" badge on auto-dispatched events so users know what the system did vs. what they triggered.
- [x] **Skill history on idle rows** — `getSkillRunHistory(repoId)` queries `portfolio_events` for the most recent `agent_skill_report` per skill; each idle skill row now shows "X days ago · N findings" so users know whether a skill has run before and what it found.
- [x] **Inline report preview** — when a skill transitions to "Report ready ↓", the first 2 findings appear inline in the skill row (fetched from `agent-task-status` endpoint). No scroll to Agent History required to see what ran. Clicking the badge anchors to `#agent-history` for the full report.

#### 56-B Agent Intelligence
- [x] **`get_skill_findings` MCP tool** — returns raw findings array + summary from the most recent skill run for a repo. Separate from `get_skill_history` (prose-formatted) — this returns structured JSON for agents to act on programmatically. Agents preparing a `/ship` objective can read exactly what `/health` found.
- [x] **Findings in `get_coding_brief`** — "Last /health Report" (or whatever skill ran most recently) section added to the coding brief. Agents start every session knowing the current diagnosis, not just health scores.
- [x] **`suggestedNextSkill` in webhook metadata** — Nexus worker computes the suggested follow-up skill from findings using the same inference logic as the UI. Stored in `agent_skill_report` event metadata. G8 orchestrator can pick this up without re-running inference.
- [x] **Finding-specific objectives** — suggested action objectives now include the most relevant finding text (e.g., "Fix TypeScript error: proxy.ts exports a config object but will never run as middleware" instead of the generic "Fix TypeScript errors in repo-name").

#### 56-C Architecture Cleanup
- [x] **Per-taskId polling** — `GstackSkillLauncher` now stores the `taskId` returned by `queueGstackSkill` per skill and polls by `?taskId=...` instead of `?repoId=...`. Eliminates status misattribution when multiple skills run; readies the component for G8 parallel skill execution.
- [x] **`getSuggestedActions` extracted** — moved from `skill-report-findings.tsx` to `src/lib/skills/suggest-actions.ts`. Tests now import the real function; `gstack-g7.test.ts` was testing a mirrored copy that could silently diverge.
- [ ] **`SKILLS_BY_PHASE` to nexus-utils** — icon, color, description, and phase grouping data still defined inside `gstack-skill-launcher.tsx`. Moving to `nexus-utils.ts` makes it importable in tests and reduces launcher file size. Planned for G8.

---

### Phase 57 — OpenClaw Integration + Fully Agentic Loop

**Goal:** Replace the bare `claude /skill` spawn with OpenClaw's richer agent runtime, and close the feedback loop so skills auto-chain without human intervention.

#### Why OpenClaw over bare claude

OpenClaw is an open-source local agent platform (local Gateway on port 7070) that natively runs Claude Code + gstack skills with memory persistence and a background heartbeat. The existing Nexus worker already sets `OPENCLAW_SESSION=true` — OpenClaw was the implied execution target all along.

#### Topology

```
RepoHQ (Vercel) → POST /internal/agent-tasks
Nexus API (Render) → BullMQ (Render Redis) → Nexus Worker (LOCAL, co-located with OpenClaw)
  gstack-{skill}.sh → OPENCLAW_GATEWAY_URL set → POST localhost:7070/run
  OpenClaw Gateway → gstack-openclaw-{skill} → output.json (nexus-agent-output-v1)
  webhook: agent_skill_report → RepoHQ → auto-queues suggestedNextSkill (1 hop)
```

Nexus API stays on Render (cloud-accessible). Worker runs locally where OpenClaw lives, consuming Render's Redis queue. Backwards-compatible: all scripts fall back to bare claude CLI when `OPENCLAW_GATEWAY_URL` is unset.

#### 57-A — Agent Skill Routing (Nexus)

- [x] G6 dynamic skill routing: `skillName` in `contextNotes` selects the correct gstack script
- [x] All 9 gstack-*.sh scripts invoke `claude /skill --print --dangerously-skip-permissions`
- [x] OpenClaw routing removed — see Phase 58-G notes

#### 57-B — Extended inferNextSkill (Nexus)

- [x] `inferNextSkill()` extracted from `src/worker.ts` to `src/lib/infer-next-skill.ts` — now exported and independently testable
- [x] Extended from 4 → 9 skill coverage: `investigate`, `canary`, `qa`, `ship`, `document-release` all infer meaningful next skills from findings text
- [x] Added `stripPassingFindings()` filter (mirrors RepoHQ's `suggest-actions.ts`) — prevents `"0 failed checks"` from triggering `investigate` via false keyword match

#### 57-C — Skill Chain Auto-Queue (RepoHQ)

- [x] `queueSuggestedSkill()` added to `src/lib/actions/nexus.ts` — session-less, tags `contextNotes` with `source:'skill-chain'`, `chainDepth:1`, `parentSkill` to prevent infinite loops
- [x] Auto-chain `after()` block added to `src/app/api/webhooks/agent-events/route.ts` — fires `queueSuggestedSkill` on `agent_skill_report` when `suggestedNextSkill` is present, `autoDispatchEnabled` is true, and the originating task was not itself a chain
- [x] `SKILLS_BY_PHASE` events with `source:'skill-chain'` get "Chain" badge in Agent History (UI work tracked under G8)

#### 57-D — Skill Chain Auto-Queue (RepoHQ)

- [x] `queueSuggestedSkill()` in `nexus.ts` — queues suggested follow-up skill to Nexus with `source:'skill-chain'` and `chainDepth:1`
- [x] Auto-chain `after()` block in `agent-events/route.ts` — fires when `suggestedNextSkill` present, `autoDispatchEnabled` true, and originating task was not itself a chain
- [x] `chain-skill` heartbeat endpoint removed — see Phase 58-G

#### The Closed Loop

```
[Analyze]   Monday cron → generateAdvisor() → top 5 quantified actions
[Advise]    autoDispatchAdvisorActions() — OR — get_next_action() MCP
[Execute]   Nexus BullMQ (concurrency 3) → worker (Render) → gstack-{skill}.sh → claude /skill
[Report]    output.json → Nexus → notifyRepoHQ() with suggestedNextSkill
[Measure]   agent_pr_merged → syncSingleRepo() → actualDelta → accuracy calibration
[Chain]     suggestedNextSkill + autoDispatchEnabled + !isChained → queueSuggestedSkill() (1 hop)
[Re-analyze] Next Monday: advisor reads updated health + calibrated accuracy → new top 5
```

#### Post-ship Self-Improvement Loop (iters 1–11)

A 10-hour automated improvement loop ran over Phase 57 and found/fixed:

| Iter | Category | Finding | Fix |
|------|----------|---------|-----|
| 1 | Validation | TypeScript clean, bash syntax clean | n/a |
| 2 | **CRITICAL** | OpenClaw gateway is WebSocket, not HTTP REST — all 9 scripts had `curl POST` to non-existent endpoint | Replaced with `openclaw agent --local` |
| 2 | Config | OPENCLAW_GATEWAY_URL (wrong concept) → OPENCLAW_LOCAL (bool flag) | Nexus config.ts rewritten |
| 3 | Security | Timing attacks in 2 webhook secret comparisons | `crypto.timingSafeEqual` via shared `crypto-utils.ts` |
| 3 | Security | No runtime skill name validation — unknown string → crash in `SKILL_DEFAULTS[skill]` | `isGstackSkill()` type guard added to `nexus-utils.ts` |
| 4 | **CRITICAL** | `getSuggestedActions` (RepoHQ UI) and `inferNextSkill` (Nexus) diverged — 5 skill branches missing in UI | Added all 5 branches to `suggest-actions.ts`; 52 new tests |
| 4 | Refactor | `inferNextSkill` not exported — untestable | Extracted to `src/lib/infer-next-skill.ts` |
| 5 | Production | render.yaml worker missing 8 env vars (REPOHQ_* + OPENCLAW_*) | Added all to worker service |
| 5 | Production | TypeScript regression: `handleQueueAction` too narrow after SuggestableSkill extension | Fixed to `GstackSkill` |
| 6 | Feature | `gstack-openclaw-health` skill not yet written | Written with nexus-agent-output-v1 contract support |
| 8 | OpenClaw | Auth model: `openclaw --local` uses claude-cli provider (same binary) — no extra auth needed | Documented; added `_OPENCLAW_READY` pre-flight guard to all 9 scripts |
| 9 | YAML | `OPENCLAW_LOCAL: false` unquoted YAML boolean in render.yaml | `value: 'false'` (quoted string) |
| 10 | Testing | No test for `_OPENCLAW_READY` routing logic | 23-test bash integration suite |
| 11 | Logic | `infer-next-skill.ts` lacked `stripPassingFindings()` — "0 failed" would trigger `investigate` | Added positivity filter mirroring `suggest-actions.ts` |

### Phase 58 — Security Hardening & Code Quality

Security audit findings addressed after external review.

#### 58-A — Encryption at Rest
- [x] AES-256-GCM `encrypt()` / `decrypt()` added to `src/lib/crypto-utils.ts`
- [x] `github_token` encrypted on every OAuth sign-in (`auth.ts`) and decrypted at all 6 Octokit read sites
- [x] `llm_keys` (per-provider API keys) encrypted on save in `actions/llm.ts`, decrypted in `ai/adapter.ts`
- [x] `decrypt()` is backwards-compatible: values without `enc:` prefix pass through unchanged (zero-downtime migration)
- [x] `ENCRYPTION_KEY` env var documented in `.env.example` and `AGENTS.md`

#### 58-B — CI Build Gate
- [x] Second `build` job added to `.github/workflows/ci.yml` — runs `npm run build` with stub env vars on every push
- [x] Catches import errors and `'use server'` constraint violations that `tsc --noEmit` misses (CSS imports, shadcn path errors, etc.)

#### 58-C — Uptime Check Fix
- [x] Deployment uptime checker now treats `response.status < 400` as healthy (was `response.ok`, which incorrectly marked 3xx redirects as "down")
- [x] Fixes false "Deployment down" badge on repos with www-redirect or Vercel cold-start responses

#### 58-D — Type Safety
- [x] `githubRepo: any` in `sync.ts` replaced with typed `GithubRepoInput` interface covering all fields accessed
- [x] Compatible with both the Octokit `paginate` response and the hand-crafted stubs in agent-events and on-demand sync paths

#### 58-E — Agent/Developer Experience
- [x] `AGENTS.md` populated with encryption rules, `'use server'` constraints, cron conventions, and hard rules that caused prior production breaks
- [x] Vercel cron (`vercel.json`) reduced to `gstack-self` only — removed 5 entries duplicated by GitHub Actions

#### 58-G — OpenClaw Removal + BullMQ Hardening

OpenClaw is not publicly available and required running the Nexus worker locally (killing the "wake up to merged PRs" promise). Removed entirely; BullMQ now provides parallel execution natively.

**Removed:**
- [x] `OPENCLAW_LOCAL` + `OPENCLAW_GATEWAY_TOKEN` from Nexus `config.ts` and `agent-runner.ts`
- [x] OpenClaw routing block (`_OPENCLAW_READY` pre-flight + `openclaw agent --local` branch) from all 9 gstack scripts — bare `claude /skill` is now the only execution path
- [x] `render.yaml` OpenClaw env var entries
- [x] `/api/agent/chain-skill` heartbeat endpoint (RepoHQ)
- [x] `OPENCLAW_CHAIN_SECRET` from RepoHQ `.env.example`

**BullMQ hardening (Nexus `src/worker.ts`):**
- [x] `concurrency: 3` — 3 agent tasks run in parallel; each spawns an independent subprocess, no shared state risk
- [x] `lockDuration: 60_000` — 60 s lock, auto-renewed every 30 s; prevents false stall detection on long agent runs
- [x] `stalledInterval: 30_000` — check for stalled jobs every 30 s
- [x] `maxStalledCount: 1` — fail immediately on stall; `failed` handler fires and notifies RepoHQ to clear the lifecycle guard
- [x] `worker.on('error', ...)` — logs Redis/connection errors without crashing the process
- [x] `worker.on('stalled', ...)` — logs stall events for observability
- [x] Graceful shutdown: 30 s grace period via `setTimeout` + `worker.close(true)` force-close fallback; SIGINT/SIGTERM both handled

#### 58-F — AI Summary Per-Repo Queue
- [x] `?enqueueRepos=1` endpoint creates one `ai_summary_jobs` row per repo across all users
- [x] GitHub Actions cron now enqueues all repos then polls `?process=1` in a loop until the queue drains
- [x] Each `process` call handles a single repo job end-to-end via `generateRepoSummary()` with the user's configured LLM adapter
- [x] Cleaner than the previous per-user chunked approach; jobs are individually retryable and observable via the `ai_summary_jobs` table

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

**GitHub Actions (canonical trigger — `.github/workflows/cron-*.yml`):**

| Workflow | Schedule | Endpoint |
|----------|---------|---------|
| cron-sync | every 6h | `/api/cron/sync` |
| cron-security | 03:00 daily | `/api/cron/security` |
| cron-deployments | every 12h | `/api/cron/deployments` |
| cron-ai-summary | 05:00 Sunday | `/api/cron/ai-summary` (enqueue per-repo jobs then process loop) |
| cron-digest | 06:00 Monday | `/api/cron/digest` |

**Vercel cron (daily — gstack-self only):**

| Endpoint | Time (UTC) | What it does |
|----------|-----------|-------------|
| `/api/cron/gstack-self` | 07:00 daily | Self-scan RepoHQ with /health + /qa-only → auto-queue fix tasks |

All routes require `Authorization: Bearer $CRON_SECRET`. Vercel cron is used only for `gstack-self` because it must run daily regardless of git activity; all other jobs are driven by GitHub Actions, which provides logs, retry, and manual dispatch.
