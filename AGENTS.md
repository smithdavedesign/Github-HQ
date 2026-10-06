<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

---

## Architecture

- **Framework**: Next.js App Router (server components + server actions). No pages/ directory.
- **Database**: Neon Postgres via Drizzle ORM. Schema in `src/lib/db/schema.ts`.
- **Auth**: Auth.js v5 (NextAuth) with DrizzleAdapter. Session strategy is `database` — no JWTs.
- **Styling**: Tailwind + shadcn/ui (`src/components/ui/`). Do NOT import from `shadcn/tailwind.css` — it does not exist.
- **AI**: Multi-provider LLM adapter in `src/lib/ai/adapter.ts`. Always go through `getLLMAdapter(userId)`.

## Critical conventions

### Server actions (`'use server'` files)
- Never re-export a non-async value from a `'use server'` file — Next.js throws at build time.
- All exports from `'use server'` files must be async functions.

### Encryption
- `githubToken` and `llmKeys` are AES-256-GCM encrypted via `src/lib/crypto-utils.ts`.
- **Always** call `encrypt()` before writing these to the DB.
- **Always** call `decrypt()` before passing to external clients (Octokit, Anthropic SDK, etc.).
- `ENCRYPTION_KEY` must be a 64-char hex string. Generate: `openssl rand -hex 32`.
- `decrypt()` is backwards-compatible: values without the `enc:` prefix are returned as-is.

### Database
- All schema changes go in `src/lib/db/schema.ts`. Run `npm run db:push` to apply.
- Use `dbOp()` guard in server actions to wrap Drizzle calls.
- Never do N+1 queries — pre-fetch and use a Map.

### GitHub sync
- `syncSingleRepo` accepts `GithubRepoInput` (typed interface in `src/lib/github/sync.ts`) — not `any`.
- Callers that build stub objects must satisfy that interface.

### Cron jobs
- GitHub Actions (`.github/workflows/cron-*.yml`) are the canonical trigger. GitHub disables scheduled workflows after 60 days without a commit; the stale-data banner (`src/lib/health/freshness.ts`) and the morning report's System health block flag it. Re-enable with `gh workflow enable`.
- Vercel cron (`vercel.json`) is fallback only. Do not add duplicate schedules for the same route.
- All cron routes are guarded by `verifyCronSecret()`.

### Server-only modules
- `'use server'` only on files whose exports are browser-callable actions that derive the user from the session.
- Functions that take a `userId` (cron, webhooks, internal helpers) live in modules starting with `import 'server-only'`, never in a `'use server'` file (e.g. `src/lib/agents/nexus-dispatch.ts`).

### E2E tests
- The suite runs against `.env.local`'s DATABASE_URL, which is production. Only seed rows you can identify and delete. Anything that overwrites or deletes shared rows must `test.skip(!DISPOSABLE_DB, …)` (`tests/e2e/helpers/disposable-db.ts`).

## Worker bootstrap (Nexus / CI worktrees)

**Before running any check or making any fix, the agent MUST install dependencies.**
The Nexus worktree is a bare git clone — there are no `node_modules`.
Skipping this step means `tsc`, `eslint`, `vitest`, and `next build` are all unavailable
and any health or fix task will silently fail.

A universal bootstrap script is included at the repo root:

```bash
# Step 1 — bootstrap (detects stack, installs deps, verifies toolchain)
bash bootstrap.sh

# Step 2 — now run checks / make fixes
npm run typecheck
npm run lint
npm test
```

`bootstrap.sh` handles npm / yarn / pnpm / bun / Python / Ruby / Go / Rust — it
detects the right package manager from lockfiles and exits non-zero on failure.

If `bootstrap.sh` fails, **stop and report** rather than proceeding with missing tooling.

## Build & test commands

```
npm run typecheck   # must pass
npm run lint        # must pass (--max-warnings=0)
npm test            # vitest unit tests
npm run build       # next build — MUST pass before shipping
npm run dead-code   # knip unused exports
```

### Environment variables required for `npm run build`

`next build` evaluates edge-runtime bundles at build time.  If the following
variables are absent the build will fail with a database or auth error:

| Variable | Purpose | Dummy value safe for CI |
|---|---|---|
| `DATABASE_URL` | Neon Postgres connection string | any non-empty string |
| `AUTH_SECRET` | Auth.js session signing | any 32-char string |
| `GITHUB_CLIENT_ID` | GitHub OAuth | any string |
| `GITHUB_CLIENT_SECRET` | GitHub OAuth | any string |
| `CRON_SECRET` | Cron route guard | any string |
| `ENCRYPTION_KEY` | AES-256 key (must be 64 hex chars) | `0000…0001` (64 chars) |
| `NEXT_PUBLIC_APP_URL` | Redirect URLs | `http://localhost:3000` |

The GitHub Actions `build` job in `.github/workflows/ci.yml` already injects all
of these as dummy values.  **Vercel preview deployments** must also have these set
under _Project → Settings → Environment Variables_ (target: Preview + Production).
Without them, Vercel's preview build will fail on edge routes that import `@/lib/db`.

## Hard rules

- Do not store tokens or API keys in plaintext — use `encrypt()`.
- Do not skip `npm run build` — the CI `build` job gates every push.
- Do not add `'use client'` to server action files.
- Do not add new cron schedules without checking for existing duplicates.
