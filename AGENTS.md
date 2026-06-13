<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
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
- GitHub Actions (`.github/workflows/cron-*.yml`) are the canonical trigger.
- Vercel cron (`vercel.json`) is fallback only. Do not add duplicate schedules for the same route.
- All cron routes are guarded by `verifyCronSecret()`.

## Build & test commands

```
npm run typecheck   # must pass
npm run lint        # must pass (--max-warnings=0)
npm test            # vitest unit tests
npm run build       # next build — MUST pass before shipping
npm run dead-code   # knip unused exports
```

## Hard rules

- Do not store tokens or API keys in plaintext — use `encrypt()`.
- Do not skip `npm run build` — the CI `build` job gates every push.
- Do not add `'use client'` to server action files.
- Do not add new cron schedules without checking for existing duplicates.
