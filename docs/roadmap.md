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

## Up Next

### Phase 4 — Opportunity Scoring *(original)*
Which projects deserve your attention?

```
Opportunity Score =
  Revenue Potential  × 30%
  Recent Activity    × 25%
  Health Score       × 25%
  Traffic / Stars    × 20%
```

- [ ] Opportunity score calculation and storage
- [ ] "Needs attention" smart list on dashboard
- [ ] "Abandoned but high-potential" detector

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
| Historical health score snapshots | Needs a time-series table + cron to write snapshots |
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
