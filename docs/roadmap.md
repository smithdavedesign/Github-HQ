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

## Phase 5 — Claude Code Integration ✅ Shipped

- [x] **Analyze with Claude** button on every repo detail page
- [x] Deep analysis: architecture pattern, strengths/concerns, security rating, code quality rating, tech debt level
- [x] Prioritised action plan (High/Medium/Low) with rationale
- [x] Overall score 0–100 from Claude
- [x] Analysis stored in DB (`claude_analysis` jsonb), shown in dedicated Analysis tab
- [x] Prompt caching on system prompt (cost-efficient for bulk runs)
- [ ] Compare health score before/after recommendations — deferred (needs historical snapshots)

---

## Phase 6 — Extended Deployment Support ✅ Shipped

- [x] **Auto-discover** button: fetches GitHub Environments + GitHub Pages via GitHub API
- [x] Homepage URL auto-added as deployment if set on repo
- [x] Provider auto-detected from URL pattern (Vercel, Netlify, Render, Railway, Fly, GitHub Pages, AWS, Azure)
- [x] Deployment manager on repo detail: add/remove URLs, manual check, auto-discover
- [x] Provider badges and deployment name labels on all URLs
- [x] Remove button per deployment URL
- [ ] Vercel API deployment history (build logs, preview URLs) — needs `VERCEL_TOKEN`
- [ ] Netlify/Render/Railway API integrations — needs per-platform tokens

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
| Sync is fire-and-forget — no live progress | Fixed Phase 2: TanStack Query polls `/api/sync-status` |
| Dark mode flashes on hard reload (manual preference) | Acceptable trade-off; no script injection |
| Cron runs once/day on Vercel Hobby | Upgrade to Vercel Pro for higher frequency |
| `neon-http` driver has no transactions | All writes are idempotent upserts |
| Security scan requires Dependabot to be enabled per-repo | User must enable in GitHub settings |
| Vercel/Netlify/Render deployment history requires API tokens | Add tokens to `.env.local` when available |
| Claude analysis depends on metadata only (no file access) | Claude Code MCP integration planned for Phase 5 extension |
