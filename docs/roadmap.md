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

---

## Phase 2 — Deeper Insights

### Sync improvements
- [ ] Real-time sync progress indicator (poll `scans` table with TanStack Query)
- [ ] Per-repo manual re-sync from the detail page
- [ ] Sync error reporting — surface which repos failed and why
- [ ] Rate limit guard — respect GitHub's `X-RateLimit-Remaining` header

### Repository detail
- [ ] 90-day commit activity chart (Recharts)  
- [ ] Dependency version staleness (days since last npm update)
- [ ] GitHub Actions workflow run status
- [ ] Branch protection rules check

### Table improvements
- [ ] Saved views (persist column layout and filters to localStorage)
- [ ] Group by: framework / hosting / health tier
- [ ] Revenue Generating flag toggle in the table
- [ ] Manual tags (e.g. "client-work", "side-project")

---

## Phase 3 — Revenue & Cost Tracking

- [ ] Per-project revenue fields (MRR, ARR, one-time)
- [ ] Vercel spend tracking via Vercel API
- [ ] Anthropic API usage per project
- [ ] OpenAI API usage per project  
- [ ] AWS cost allocation tags
- [ ] Profit per project (revenue - costs)
- [ ] Portfolio P&L summary card on dashboard

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
