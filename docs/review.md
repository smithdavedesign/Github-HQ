# RepoHQ — Honest Review
*Reviewed June 13, 2026. Sources: full repo read-through + live site at https://repohq.vercel.app.*

---

## TL;DR

RepoHQ is **genuinely impressive for a solo project** — the feature set rivals small-team SaaS products, the architecture is mostly sound, and the core idea is compelling. But right now it's caught in a dangerous middle zone: ambitious enough to impress a technical audience, yet not polished enough to land with a wider one. There are real quality/stability gaps hiding under excellent documentation. The project needs to decide what it actually *is* before it ships anything else.

---

## 1. The Idea

**Good, and genuinely useful.** A unified health-score view of your GitHub portfolio with AI-driven prioritisation solves a real problem every developer with more than 10 repos has felt. The opportunity score, lifecycle management, and advisor loop are differentiating angles. The MCP server is ahead of the curve.

The positioning is a little unfocused though. The README promises 35+ features across 8 integrations. For a solo project, this leads to the "everything and the kitchen sink" problem — none of the features get the depth they deserve, and the value proposition is hard to explain in one sentence.

---

## 2. Code Quality

### What's good

- **Scoring engine** (`src/lib/health/scoring.ts`) is clean, pure-functional, well-commented, and has real unit tests. The logarithmic revenue scaling is thoughtful.
- **Server actions** (`src/lib/actions/repositories.ts`) all wrap DB calls in a uniform `dbOp()` guard that catches, logs, and re-throws clean error messages. Good pattern.
- **Auth** is correctly using `session: { strategy: 'database' }` and storing the GitHub token server-side — no tokens in JWTs, no client-side secrets. `verifyCronSecret` is fail-secure (returns `false` when the env var is unset).
- **`syncAllRepos`** pre-fetches all existing repo states in a single query before the loop instead of N+1 queries. Good.
- **DB schema** is well-structured, with meaningful indexes and proper cascade deletes.
- **Test count** — 142 unit tests + 38 e2e tests is healthy for a project this size. The unit tests covering valuation, health scoring, and NL filter parsing are particularly solid.

### What's concerning

- **`any` proliferates in sync.ts**: `syncSingleRepo` takes `githubRepo: any` and the comment says "using `any` intentionally." The GitHub REST API *is* typed via `@octokit/rest` — this is avoidable and silently hides type errors.
- **The GitHub OAuth token is stored in plaintext** in `users.github_token`. The schema comment says "stored encrypted by Auth.js adapter" but the actual DrizzleAdapter stores it in plain text by default — Auth.js does not encrypt it. This is a real security issue if the database is ever compromised.
- **`llm_api_key` / `llm_keys`** — user-provided API keys are stored plaintext in Postgres. There's a `crypto-utils.ts` file in the lib directory but it's unclear whether it's applied to these fields at the DB layer. If it's not, any DB leak exposes all users' AI provider keys.
- **The build just failed because of a hallucinated import** (`shadcn/tailwind.css`). This happened because Claude (me, in a previous session) generated code without checking what actually exists in the project. It's a reminder that the agent-generated code path needs a build-gating step.
- **`gitHub_repo.any`-typed sync path** means schema drift between GitHub API responses and what the app expects can only be caught at runtime. At scale this will silently produce wrong data (null health scores, missing language fields, etc.).
- **The dashboard page** makes 19 parallel `Promise.all` calls on every load — every page view hits Postgres 19 times. There's no HTTP caching layer, no Redis, and the Neon serverless HTTP driver has a cold connection overhead. For a single-user personal tool this is fine; for multi-tenant use it's a problem.

---

## 3. Architecture

**The good**: The App Router / server actions split is used correctly. Heavy data access stays server-side. TanStack Query is only used for polling (sync status), not as a substitute for RSC data fetching. The `after()` deferred sync avoids blocking the response. The cron → GitHub Actions → Vercel architecture is clever.

**The fragile parts**:

- **Single-file schema** at 500+ lines with 25+ tables all in one file. As the project grows this becomes a maintenance headache — a refactor into domain modules (`auth.schema.ts`, `repos.schema.ts`, etc.) would pay dividends.
- **`'use server'` + Turbopack enforcement** is a recurring source of bugs. The current session started with a build break caused by re-exporting a non-async value from a `'use server'` file. This constraint isn't obvious and will keep biting.
- **AI summary queue (`ai_summary_jobs`)** was added reactively to fix a 504 timeout. The table has no index on `status` — every `?process=1` call does a full table scan to find the next `queued` job. Fine now with small data, a problem at scale.
- **The cron system spans three mechanisms**: Vercel cron config (`vercel.json`), GitHub Actions workflows, and the new DB job queue. All three can trigger the same route. The `.yml` workflow file was partially updated in this session; the old per-user loop and the new enqueue/process pattern coexist in git, making it unclear which is canonical.
- **`CLAUDE.md` contains only `@AGENTS.md`** and `AGENTS.md` contains only a Next.js version warning. For a project that's actively using Claude Code to generate features, this is sparse — agents have no project context, conventions, or DO-NOT-DO list beyond "read the Next.js docs."

---

## 4. Production Site

The public portfolio at `/u/smithdavedesign` loads and is functional. Observations:

- **Average health score shown: 52** across 58 repos. The tool is telling you your own portfolio is "At Risk" by its own definition (threshold is 55). That's honest but worth noting — the product's first impression to any visitor is that your portfolio health is mediocre. If you're selling this to developers as a way to showcase their repos, the score needs context ("52 is above the global average for portfolios this size") or the scoring thresholds need calibration.
- **RepoHQ itself shows "Deployment down"** on the public portfolio page. The app is monitoring its own deployment URL — and reporting it as down while you're visiting it. This is almost certainly a false positive (the uptime check may be hitting a cold start or checking the wrong URL) but it looks bad. Fix this before showing anyone the site.
- **Login page** is clean and minimal — good. No unnecessary friction.
- **No error state on the public page** if a user doesn't have `publicProfile = true` — it would just show an empty/broken state. Should show a 404 or a "This profile is private" message.

---

## 5. Docs

The README is **unusually thorough** — 35 phases documented, full schema, scoring formulae, MCP tool table, deploy instructions. For a developer audience this is excellent. It's also the longest README I've read in a while — a non-developer would bounce immediately.

The architecture doc is solid and accurate. The roadmap is honest about what's done vs pending. No "coming soon" vaporware.

**What's missing**:
- A `CONTRIBUTING.md` (even if just "this is a personal project").
- Anything in `CLAUDE.md` / `AGENTS.md` that would help an agent understand the codebase conventions before generating code. The recurring build breaks from AI-generated code (the `shadcn` import, the `'use server'` re-export) are partly a symptom of this.
- Test coverage for the sync logic — the most complex and most failure-prone part of the system has zero unit tests.

---

## 6. The Honest Opinion

This project is doing a lot right. The concept is good, the scoring engine is well-thought-out, the test coverage is better than most side projects at this feature count, and the MCP integration is genuinely interesting.

But there are three uncomfortable truths:

**1. The project is optimising for features over depth.** 35 phases shipped, but several of them are thin. The "graveyard" page is a list. The "dependency map" is a force-directed SVG. The "CEO report" is a claude-haiku call with a cached prompt. None of these are bad — they're just shallow implementations of ideas that could be powerful with more depth.

**2. Agent-generated code is accumulating debt.** Multiple session-breaking bugs (the `SKILL_META` re-export, the `shadcn` import) came from AI-generated code that bypassed the type checker and build. There's currently no CI step that runs `npm run build` on PRs. Without that gate, every agent session risks shipping broken code to Vercel.

**3. The target user is unclear.** Is this a personal tool for David Smith? A template others can deploy? A SaaS with a pricing page and Stripe integration? Right now it's trying to be all three and excelling at none. The pricing page exists but `stripePlan` defaults to `'free'` and there's no paywall. The "Deploy Your Own" section assumes deep technical knowledge. The public profile is designed as a showcase but shows an average health score of 52 and a self-reported "Deployment down" warning.

---

## 7. Prioritised Recommendations

| Priority | Issue | Recommendation |
|----------|-------|----------------|
| 🔴 Critical | GitHub token + AI API keys stored plaintext | Apply encryption at the application layer before writing to DB. Use `crypto-utils.ts` if it exists, or add AES-256-GCM with a `ENCRYPTION_KEY` env var. |
| 🔴 Critical | No CI build gate | Add a GitHub Actions workflow that runs `npm run build` + `npx tsc --noEmit` on every push. This would have caught the last two production breaks. |
| 🟠 High | RepoHQ shows "Deployment down" for itself | Debug the uptime check URL — it's almost certainly a redirect or cold-start false positive. Fix before demoing. |
| 🟠 High | Average health score 52 on public portfolio | Add context to the score display ("better than X% of portfolios scanned"), recalibrate thresholds, or exclude archived/experimental repos from the average. |
| 🟠 High | `ai_summary_jobs` missing index on `status` | `CREATE INDEX ON ai_summary_jobs(status)` — add to schema and push migration. |
| 🟡 Medium | `githubRepo: any` in sync.ts | Use `Endpoints['GET /repos/{owner}/{repo}']['response']['data']` from `@octokit/types`. |
| 🟡 Medium | `CLAUDE.md` is empty | Document project conventions, forbidden patterns (e.g. no re-exports from `'use server'` files), and the test/build commands. This directly reduces agent-caused build breaks. |
| 🟡 Medium | Cron trigger ambiguity | Pick one canonical trigger per cron job and remove the others. Suggested: GitHub Actions for primary, Vercel cron as fallback only. |
| 🟢 Low | Single-file schema | Split into domain modules once the schema stabilises. |
| 🟢 Low | Dashboard 19-way parallel fetch | Add `cache()` wrapping or move to React `use()` with Suspense boundaries so individual cards can stream independently. |
