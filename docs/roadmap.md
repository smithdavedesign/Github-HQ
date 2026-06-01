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
- [x] Neon PostgreSQL persistence via Drizzle ORM
- [x] Vercel Cron jobs for automated daily updates
- [x] Dark mode (CSS media query + localStorage toggle)
- [x] Settings page — profile, OAuth scopes, sync history, cron schedule
- [x] 54 Vitest unit tests + 38 Playwright e2e tests

### Phase 2 — Deeper Insights
- [x] Real-time sync progress bar (TanStack Query polls `/api/sync-status` every 3s)
- [x] Per-repo manual re-sync button on detail page
- [x] Rate limit guard — backs off when `X-RateLimit-Remaining` < 300
- [x] GitHub Actions build status fetched during sync, shown in table and detail
- [x] 13-week commit activity chart (Recharts) on repo detail Overview tab
- [x] Tags editor — inline chip input, persists to DB
- [x] Saved views — save/load/delete column + sort presets in localStorage
- [x] Revenue Generating flag toggle directly in the table row
- [x] MRR and Build Status columns in the repos table

### Phase 3 — Revenue & Cost Tracking
- [x] MRR, ARR, monthly cost fields on every repo (editable via Revenue tab)
- [x] Live profit and margin preview in the Revenue editor
- [x] Portfolio P&L summary on the dashboard (hidden until data exists)
- [x] MRR column in repos table (sortable)
- [x] Revenue flag auto-set when MRR > 0

### Phase 5 — Claude Code Integration
- [x] **Analyze with Claude** button on every repo detail page
- [x] Deep analysis: architecture pattern, security rating, code quality rating, tech debt level
- [x] Prioritised action plan (High/Medium/Low) with rationale per item
- [x] Overall score 0–100 from Claude (separate from health score)
- [x] Results stored in DB (`claude_analysis` jsonb) and shown in dedicated Analysis tab
- [x] System prompt cached (ephemeral) for cost efficiency on bulk runs

### Phase 6 — Extended Deployment Support
- [x] **Auto-discover** button — fetches GitHub Environments + GitHub Pages via GitHub API
- [x] Homepage URL auto-included in discovery
- [x] Provider auto-detected from URL: Vercel, Netlify, Render, Railway, Fly.io, GitHub Pages, AWS, Azure
- [x] Deployment manager on repo detail — add, remove, check URLs
- [x] Named labels and provider badges per deployment URL

### Phase 7 — Shareable Portfolio View
- [x] Opt-in toggle in Settings → Portfolio (default off)
- [x] Public route `/u/[githubLogin]` — no auth, ISR 1h cache
- [x] Profile card: avatar, name, stats (total repos, avg health, top languages)
- [x] Public repos only — health badge, tech stack pills, AI summary, deployment status dot
- [x] Powered-by footer linking back to RepoHQ

### Phase 8 — Automated Triage Digest
- [x] `digests` table stores weekly Claude briefing per user
- [x] `/api/cron/digest` — Mondays at 06:00 UTC
- [x] Top 3 priorities with urgency (critical/high/medium), reason, concrete action, repo link
- [x] "Weekly AI Briefing" card on dashboard — visible if digest < 8 days old
- [x] Uses claude-haiku for speed; system prompt cached

### Phase 9 — Health Score History (Drift Detection)
- [x] `health_score_history` table — unique on `(repo_id, recorded_date)`
- [x] Snapshot written by daily sync cron after each full sync (idempotent)
- [x] `getHealthTrend()` compares current score to oldest snapshot
- [x] HealthBadge shows ↑/↓ arrow with delta tooltip after 7+ days of history
- [ ] 30-day trend line on Analytics page — needs more data (ships automatically after ~30 syncs)
- [ ] Drift alerts integrated into triage digest

### Phase 10 — Natural Language Query
- [x] Sparkle input bar above repos table — plain English filter queries
- [x] `/api/nl-query` — claude-haiku returns structured `NLQueryFilters` (no raw SQL)
- [x] 14-field filter vocabulary: health, activity, last push, visibility, language, framework, DB, revenue, security, stars, MRR, sort
- [x] "AI filtered: [explanation]" banner with clear button
- [x] Pure JS predicate chain applied before TanStack Table — safe by design
- [x] 28 unit tests covering all filter cases and sort direction

---

### Phase 4 — Opportunity Scoring
- [x] `opportunity_score` column in `repository_metrics` (0–100)
- [x] 4-factor weighted formula: Revenue Potential × 30%, Activity × 25%, Health × 25%, Stars × 20%
- [x] Revenue potential uses log-scale for MRR repos; signals-based proxy for non-revenue repos
- [x] Backfill for all existing repos on deploy
- [x] Calculated every sync and security-score update
- [x] "Needs Attention" card on dashboard — high opportunity + poor health
- [x] "Dormant but Promising" card — high opportunity + low/no activity
- [x] Opportunity column in repos table (sortable, color-coded)
- [x] 24 unit tests covering all sub-scores, edge cases, and labels

---

## Up Next

### Phase 11 — Repository Lifecycle Status
- [x] `lifecycle_status` column on repositories table (8 stages: Idea→Building→Beta→Production→Growing→Maintaining→Sunsetting→Archived)
- [x] Lifecycle selector on repo detail Overview tab — updates instantly
- [x] Lifecycle badge column in repos table (color-coded per stage)
- [x] Dashboard distribution card: counts by lifecycle stage

### Phase 12 — Portfolio Health Feed
- [x] `/feed` page in authenticated layout — sidebar nav entry
- [x] Events: health drops/improvements, down/slow deployments, critical/high security alerts, dormant repos, failing builds
- [x] Sorted by severity (critical → warning → info → positive), then by recency
- [x] Left-border color coding + icons per event type

### Phase 13 — Technical Debt Visibility
- [x] Tech Debt column in repos table — reads from `claude_analysis.techDebt.level`
- [x] Low / Medium / High badge, color-coded, custom sort order (High first)
- [ ] Tech debt summary on dashboard (count by level)

### Phase 14 — AI Portfolio Advisor
- [x] `advisor_content` jsonb stored on `digests` table alongside weekly briefing
- [x] Pre-computes opportunity score deltas per repo before calling Claude — no hallucinated numbers
- [x] Top 5 actions ranked by impact: revenue > security > deployment > activity
- [x] Each action shows: specific repo, verb phrase, effort (quick/medium/substantial), exact delta
- [x] "Generate Advisor" button on dashboard — fires via `after()`, ~30s to complete
- [x] Extended Monday digest cron to generate both briefing and advisor in parallel
- [x] AdvisorCard on dashboard with generate/regenerate button

### Phase 15 — Repository Valuation Engine
- [x] `estimated_value`, `valuation_confidence`, `valuation_method` on `repository_metrics`
- [x] SaaS multiple method: MRR × 36–60× adjusted for health (quality) and activity (momentum)
- [x] Signal-based method: stars × $20 + deployment bonus, adjusted for activity/health floor
- [x] Confidence tiers: none / very_low / low / medium (high reserved for growth data)
- [x] Portfolio net worth card on dashboard (shows breakdown: revenue vs signal value)
- [x] Valuation column in repos table (hidden by default, toggleable)
- [x] Backfilled for all 64 existing repos
- [x] 30 unit tests covering all methods, confidence tiers, edge cases, formatValuation

### Phase 16 — Portfolio Analytics (Trend Lines)
Historical trend charts — health over time, opportunity over time, revenue over time.

- [ ] Depends on 30+ days of `health_score_history` data (accumulating automatically)
- [ ] Line chart on Analytics page: portfolio avg health over time
- [ ] Per-repo health trend on detail page Overview tab
- [ ] Revenue trend if MRR data exists

### Phase 17 — Goal Tracking
- [x] `goals` table: type (mrr | health_avg | repos_live | revenue_repos | custom), target, deadline, notes
- [x] Goal CRUD actions: createGoal, deleteGoal, updateCustomGoalProgress, refreshGoalProgress
- [x] Auto-progress computed from live data on every sync
- [x] GoalsCard on dashboard — progress bars, deadline countdown, On Track / Behind status
- [x] GoalManager in Settings — type presets, target input, optional deadline

### Phase 18 — Portfolio Resume & Shareable Reports
- [x] Portfolio resume at `/u/[username]/resume` — print-friendly, skills, top projects, stats bar
- [x] Dynamic OG image for `/u/[username]` — dark card, name, repo count, avg health
- [x] Quarterly report at `/u/[username]/report/2026-q2` — repos added, health trend, security, AI commentary
- [x] Quarter URL parsing: `YYYY-q[1-4]`, graceful when data is sparse

### Phase 19 — Dependency Risk Monitoring
Track dependency versions across all repos against the current latest.

- [ ] npm registry lookups per package.json dependency
- [ ] Version staleness score per repo
- [ ] "React 16 → current 19" style callouts on repo detail
- [ ] Dependency risk column in repos table

### Phase 20 — GitHub Webhook Real-time Sync
Move from daily cron to event-driven updates.

- [ ] GitHub App (replaces OAuth App) for webhook access
- [ ] Push event → update repository + metrics immediately
- [ ] PR event → update open PR count
- [ ] Security alert event → update security findings

### Phase 21 — Purpose Field & Focus Projects
Simple high-value metadata: why does this repo exist, and are you actively working on it?

- [x] `purpose` enum on `repositories`: Revenue | Learning | Consulting | Experiment | Open Source | Client Work | Portfolio | Infrastructure
- [x] Purpose selector on repo detail Overview tab (inline, persists to DB)
- [ ] Purpose column in repos table (filterable, hidden by default)
- [x] `is_focused` boolean on `repositories` — toggle directly from table row or detail page
- [ ] Focus badge in repos table; unfocused repos show "Not Focused" indicator
- [ ] Advisor (Phase 14) and digest (Phase 8) filter recommendations to focused repos by default

### Phase 22 — Archive Candidates
Automated scoring surfaces repos you should stop maintaining.

- [x] Archive score (0–100) derived from: commit inactivity, zero revenue, no active deployment, low health, low opportunity
- [x] "Strong Archive Candidates" card on dashboard — repos scoring above threshold
- [x] One-click lifecycle transition to Sunsetting/Archived from the card
- [ ] Archive score column in repos table (hidden by default)

### Phase 23 — Itemized Cost Tracking
Break the existing monthly cost field (Phase 3) into named line items per repo.

- [x] `cost_items` jsonb on `repository_metrics`: `[{ label: "Vercel", amount: 20 }, ...]`
- [x] Cost line-item editor on Revenue tab (add/remove rows, label + amount)
- [x] Total auto-summed, replaces existing single-field monthly cost
- [ ] Per-repo P&L: Revenue − itemized costs → net profit / loss
- [ ] Portfolio cost breakdown on dashboard (group by label across all repos)

### Phase 24 — Weekly CEO Report
Structured Monday briefing that replaces reading dashboards — portfolio state at a glance.

- [x] Extends `digests` table with `ceo_report` jsonb field
- [x] Generated alongside existing briefing + advisor in Monday cron
- [x] Sections: Portfolio Summary (value, MRR delta, avg health delta), Biggest Wins, Biggest Risks, Recommended Focus This Week
- [x] Wins/risks derived from sync deltas: stars gained, uptime streaks, health jumps, failing builds, dormant repos
- [x] "CEO Report" card on dashboard — collapsible, replaces or sits alongside WeeklyBriefing card
- [x] Uses claude-haiku with cached system prompt; structured JSON output

### Phase 25 — Time Allocation Recommendations
Answer "where should my next N hours go?" using existing opportunity and value data.

- [ ] Input: hours available (user-configurable in Settings, default 10h/week)
- [x] Output: ranked repo list with projected value delta per hour invested
- [x] Derived from: opportunity score delta potential, health improvement ceiling, revenue proximity
- [x] "Best Use of Your Time" card on dashboard — top 3 repos with impact estimate
- [x] Focused repos (Phase 21) get priority weighting; advisor-ignored repos excluded

### Phase 26 — Opportunity vs Effort Matrix
Add effort dimension to opportunity scoring and surface the quick-win quadrant.

- [ ] `estimated_effort` enum on `repositories`: low | medium | high (user-set, defaults to medium)
- [ ] Effort selector on repo detail Overview tab
- [ ] Opportunity vs Effort quadrant view on Analytics page: Quick Wins (high opp / low effort), Invest (high opp / high effort), Fill-In (low opp / low effort), Deprioritize (low opp / high effort)
- [ ] "Quick Wins" section in advisor output (Phase 14) filtered to top-right quadrant
- [ ] Effort column in repos table (hidden by default)

### Phase 27 — Idea Graveyard
Capture why repos were abandoned so you stop rebuilding the same ideas.

- [ ] `abandonment_reason` enum on `repositories`: No demand | Too competitive | Too much maintenance | Lost interest | Merged into another project | Pivoted
- [ ] Reason prompt shown when lifecycle is set to Sunsetting or Archived
- [ ] Graveyard view — filtered repos table showing only archived repos with reason + date
- [ ] Personal knowledge base: searchable, exportable
- [ ] Digest (Phase 8) references graveyard when suggesting similar new ideas

### Phase 28 — Personal Changelog
Auto-generated timeline of portfolio events — an automatic work journal.

- [ ] `portfolio_events` table: event_type, repo_id, description, occurred_at
- [ ] Events captured by sync cron: repo created, repo archived, MRR changed, health milestone crossed, deployment added, first revenue
- [ ] Manual milestone support: free-text entries attached to a repo or portfolio-wide
- [ ] `/feed` page extended with a "Milestones" tab (chronological, per-repo or portfolio)
- [ ] Annual review export: markdown summary of the year's events

### Phase 29 — Portfolio Dependency Map
Visualize which repos depend on each other and surface cascading risk.

- [ ] Fetch `package.json` from each repo via GitHub API during sync
- [ ] Cross-reference `dependencies` keys against known repo package names (fuzzy match on repo name + `name` field in package.json)
- [ ] Dependency graph stored as `internal_deps` jsonb on `repository_metrics`
- [ ] Dependency map view on Analytics page — tree or force-directed graph
- [ ] Cascade risk alert: when a shared-dependency repo drops in health, affected repos flagged in feed and digest
- [ ] "Shared by N projects" badge on repo detail for library-type repos

---

## Enterprise Direction *(future)*

- [ ] Organization Dashboard — team health, security posture, repo ownership, bus factor
- [ ] Public Portfolio Leaderboards — top indie hacker portfolios, top open source portfolios
- [ ] AI PR Reviews — Claude reviews every PR (competing with CodeRabbit)

---

## Deferred

These items require additional API access or are lower priority:

| Feature | Reason deferred |
|---------|----------------|
| Vercel deployment history (build logs, preview URLs) | Needs `VERCEL_TOKEN` with billing scope |
| Netlify / Render / Railway API integrations | Needs per-platform API tokens |
| Anthropic / OpenAI / AWS cost tracking | No per-project tracking available in those APIs |
| Dependency version staleness | Requires npm registry lookups per dep |
| Branch protection rules check | Low signal-to-noise for solo developers |
| Group by in repos table | Complex UX with TanStack Table |
| Incremental sync (only changed repos) | Nice-to-have once portfolio > 200 repos |

---

## Infrastructure

### Vercel Pro upgrade
Switching to Pro unlocks optimal cron frequency:
- GitHub Sync: every 6 hours (currently daily)
- Deployment checks: every 12 hours (currently daily)
- Security scan: daily
- AI summaries: weekly

### Performance
- [ ] Incremental sync — compare `pushed_at` to skip unchanged repos
- [ ] TanStack Query infinite scroll on repos table for very large portfolios
