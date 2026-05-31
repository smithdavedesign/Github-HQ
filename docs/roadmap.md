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
Evolution of the triage digest — instead of "here are problems," says "here's what to do to move the needle on portfolio value."

- [ ] Advisor card on dashboard, regenerated weekly
- [ ] Quantified impact: "fixing Repo A security issues could increase opportunity score by 18 points"
- [ ] Prioritised action list ranked by estimated value impact
- [ ] Extends the Phase 8 digest cron

### Phase 15 — Repository Valuation Engine
Estimated portfolio valuation with confidence ranges. Think: SaaS multiples, content site valuation, open-source sponsorship potential.

- [ ] `estimated_value` and `valuation_confidence` on repository_metrics
- [ ] SaaS valuation: MRR × 36–60× multiple (adjusted by health, growth trend)
- [ ] Non-revenue: stars + traffic + deployment signals
- [ ] Portfolio net worth card on dashboard
- [ ] Valuation column in repos table

### Phase 16 — Portfolio Analytics (Trend Lines)
Historical trend charts — health over time, opportunity over time, revenue over time.

- [ ] Depends on 30+ days of `health_score_history` data (accumulating automatically)
- [ ] Line chart on Analytics page: portfolio avg health over time
- [ ] Per-repo health trend on detail page Overview tab
- [ ] Revenue trend if MRR data exists

### Phase 17 — Goal Tracking
Set portfolio-level or per-repo goals. AI recommends which repos to focus on.

- [ ] `goals` table: type (mrr, health, repos_live), target, deadline
- [ ] Goal progress card on dashboard
- [ ] AI recommendation: "to reach $5k MRR, focus on Repo X and Repo Y"

### Phase 18 — Portfolio Resume & Shareable Reports
Auto-generated public-facing summaries for consultants, job seekers, and sharing.

- [ ] Portfolio resume at `/u/[username]/resume` — stats card designed for sharing
- [ ] Quarterly report at `/u/[username]/report/2026-q2` — charts + AI commentary
- [ ] Social card image (OG image) for portfolio pages

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
