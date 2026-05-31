# RepoHQ — Roadmap

## Phase 1 — Core Dashboard ✅ Shipped

- [x] GitHub OAuth (public + private repos via `repo` scope)
- [x] Full repository sync with pagination
- [x] Health score engine (7-factor weighted formula)
- [x] Repository intelligence scanner (framework, language, DB, hosting detection)
- [x] TanStack Table with sorting, filtering, column visibility, CSV export
- [x] Security dashboard (Dependabot alerts, secret scanning)
- [x] Production URL monitoring (uptime, response time, SSL)
- [x] AI repo summaries (Claude API — what it does, maturity, risk, actions)
- [x] Neon PostgreSQL persistence (Drizzle ORM)
- [x] Vercel deployment with daily cron jobs
- [x] Dark mode toggle
- [x] Settings page (profile, OAuth scopes, sync history, cron schedule)
- [x] 54 unit tests (Vitest) — health scoring, scanner detection, uptime, utils
- [x] 38 e2e tests (Playwright) — all pages, auth flows, table interactions
- [x] Live at https://repohq.vercel.app

---

## Phase 2 — Deeper Insights ✅ Shipped

### Sync improvements
- [x] Real-time sync progress indicator (TanStack Query polling `/api/sync-status`)
- [x] Per-repo manual re-sync button on the detail page
- [x] Sync errors logged to console with repo name
- [x] Rate limit guard — checks `X-RateLimit-Remaining`, backs off when < 300

### Repository detail
- [x] 90-day commit activity chart (Recharts bar chart from weekly_commit_data)
- [x] GitHub Actions workflow run status (latest run status on Overview tab)
- [x] Tags editor (inline chip input, persists to DB)
- [ ] Dependency version staleness — deferred
- [ ] Branch protection rules check — deferred

### Table improvements
- [x] Saved views (persist column visibility + sorting to localStorage)
- [x] Revenue Generating flag toggle directly in the table
- [x] Tags column with badge display
- [x] MRR column (sortable)
- [x] Build status column
- [ ] Group by: framework / hosting / health tier — deferred

---

## Phase 3 — Revenue & Cost Tracking ✅ Shipped

- [x] Per-project MRR, ARR, monthly cost fields in DB
- [x] Revenue editor on repo detail page (Revenue tab)
- [x] Monthly profit and margin calculated inline
- [x] Portfolio P&L summary row on dashboard (MRR, ARR, cost, profit, margin)
- [x] Revenue flag auto-set when MRR > 0
- [x] MRR column in repos table
- [ ] Vercel spend tracking via API — deferred (requires billing API access)
- [ ] Anthropic/OpenAI/AWS cost tracking — deferred (no per-project tracking in APIs)

---

## Phase 4 — Opportunity Scoring

Which projects deserve your attention?

```
Opportunity Score =
  Revenue Potential  × 30%
  Recent Activity    × 25%
  Health Score       × 25%
  Traffic / Stars    × 20%
```

- [ ] Opportunity score calculation
- [ ] "Projects that need attention" smart list
- [ ] "Abandoned but high-potential" detector

---

## Phase 5 — Claude Code Integration

- [ ] Per-repo **Analyze Repository** button → Claude reviews architecture, security, code quality
- [ ] Architecture report stored in DB, viewable in detail page
- [ ] Suggested refactors and tech debt highlights
- [ ] Compare health score before/after Claude recommendations

---

## Phase 6 — Extended Deployment Support

Currently only monitors production URLs. Planned integrations:
- [ ] Vercel API — pull deployment history, preview URLs, build failures
- [ ] Netlify API — site health and deploy logs
- [ ] Render API — service status and deploy state
- [ ] Railway — project status
- [ ] GitHub Pages — availability check

---

## Infrastructure Upgrades

### For Vercel Pro plan
- Switch cron schedules back to optimal frequency:
  - GitHub Sync: every 6 hours
  - Deployment checks: every 12 hours
  - Security scan: daily
  - AI summaries: weekly

### Performance
- [ ] Incremental sync — only fetch repos updated since `last_synced_at`
- [ ] Background job queue (for large portfolios 100+ repos)
- [ ] TanStack Query infinite scroll on repos table

---

## Known Limitations

| Limitation | Workaround / Fix |
|------------|-----------------|
| Sync is fire-and-forget — no live progress | Phase 2: poll `scans` table |
| Dark mode flashes on hard reload (manual preference) | Acceptable trade-off; no script injection |
| Cron runs once/day on Vercel Hobby | Upgrade to Vercel Pro for higher frequency |
| `neon-http` driver has no transactions | All writes are idempotent upserts |
| Security scan requires Dependabot to be enabled per-repo | User must enable in GitHub settings |
