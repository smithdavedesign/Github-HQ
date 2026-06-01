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

### Phase 32 — Ship It Nudge
- [ ] If a focused repo (`is_focused = true`) has no commits in N days, surface a card on the dashboard
- [ ] User-configurable threshold (default 7 days) via Settings
- [ ] Dismissable per-repo with a snooze

### Phase 33 — Dependency Graph: Shared External Deps
- [ ] Extend dep graph to show repos that share prominent external packages (drizzle-orm, openai, etc.)
- [ ] Shared deps shown as edge labels; more immediately useful than internal deps

### Phase 34 — Portfolio Concentration Risk
- [ ] Compute revenue concentration: % of total MRR tied to single repo
- [ ] Compute tech stack concentration: dominant framework/DB across portfolio
- [ ] Risk card on dashboard — flags single-point-of-failure when one repo > 60% of revenue
- [ ] Low effort: all data already exists, pure computation from existing metrics

### Phase 35 — One-Click Sunset Pipeline
- [ ] "Sunset" button on graveyard/archive page that triggers a GitHub Actions workflow
- [ ] Workflow: sets GitHub repo to archived (read-only via API), updates lifecycle to `archived` in DB
- [ ] Optionally pauses Vercel deployment (requires VERCEL_TOKEN)
- [ ] Writes autopsy summary to `portfolio_events` automatically on completion

### Phase 36 — Portfolio Simulation Engine
- [ ] "What if" planner: given N available hours + goal (max ARR / max health / launch beta), model expected outcomes
- [ ] Uses existing opportunity score deltas + estimated effort per repo as inputs
- [ ] Output: ranked weekly allocation table with projected portfolio score delta, ARR delta
- [ ] Comparison view: Recommended vs Actual (tracked via commit activity after the week)
- [ ] Upgrades the Advisor from "what to do" to "plan my week"

### Phase 37 — Stripe / Revenue API Integration
- [ ] OAuth or API key connection to Stripe (and optionally Lemon Squeezy, Gumroad)
- [ ] Auto-populate MRR per repo by mapping Stripe Product metadata → repo ID
- [ ] Real-time churn and LTV layered over git activity
- [ ] Removes the biggest manual input in the current flow

### Phase 38 — MCP Server (IDE Context Integration)
- [ ] Expose RepoHQ portfolio state as a Model Context Protocol server
- [ ] Endpoints: current repo lifecycle/health/focus/debt, portfolio advisor summary, active goals
- [ ] Claude Code (and other MCP clients) can query portfolio context while coding
- [ ] Prevents wasted effort on repos flagged for sunsetting; surfaces priorities in-editor
- [ ] Architecturally the most significant phase — moves intelligence from dashboard to workflow

### Phase 39 — Opportunity Cost Tracker
- [ ] Weekly report: "You spent time on Repo A. Repo B had 4x projected value this week."
- [ ] Estimated opportunity cost in dollars (missed MRR potential) and score points
- [ ] Requires approximate time tracking — inferred from commit timestamps across repos
- [ ] Changes behavior more than any dashboard card

### Phase 40 — Open-Source Template / Deploy-to-Vercel
- [ ] Strip personal data, create a clean deploy-to-Vercel one-click template
- [ ] README with full setup guide (GitHub OAuth, Neon, Anthropic API key)
- [ ] "Spotify Wrapped for your GitHub portfolio" — strong indie hacker / open source appeal
- [ ] Foundation for a hosted SaaS if desired (public portfolio page already built)

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
