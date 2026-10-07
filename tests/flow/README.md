# Agent HQ flow tests

End-to-end validation of the one-agent-system migration (roadmap Phase 81,
[docs/agent-hq-migration-prd.md](../../docs/agent-hq-migration-prd.md)): RepoHQ queues a request,
BullMQ carries it, the real factory worker runs it, and Neon, the status API and the Agents page
agree on what happened. Unit tests mock these seams; these tests don't.

```bash
docker compose --profile flow up -d   # throwaway Postgres (127.0.0.1:5433) + Redis (127.0.0.1:6380)
npm run test:flow                     # vitest: migrations, enqueue, worker, morning report (~1 min)
npm run test:flow:e2e                 # Playwright: the same flow in the browser on `next dev` (~2 min)
```

CI runs both (`.github/workflows/ci.yml`, job `flow`) on every pull request.

## What runs for real

| Piece | How |
|---|---|
| App code (server actions, API routes, `src/lib/db`) | Unmodified, in the vitest process or `next dev` |
| Neon | A local Postgres behind `harness/neon-local.cjs`, which answers the Neon HTTP driver's requests for `*.neon.local` hosts (the same JSON protocol, batches as one transaction, Postgres errors as Neon errors) |
| Schema | `drizzle-kit export` of `src/lib/db/schema.ts`, i.e. what `npm run db:push` creates |
| Redis / BullMQ | A local Redis database the suite flushes |
| The worker | `factory/worker.ts` as a child process: gates, claim, child jobs, follow-ups, reconcile, schedulers, heartbeat, shutdown |
| The job | `fixtures/fake-run.ts`, via `FACTORY_WORKER_CHILD`. run.ts's real pipeline needs Docker, LiteLLM and GitHub; the stand-in speaks the same `::trace::` / `::result::` protocol and writes Neon through the factory's own code (`Tracer`, `resolveRequest`, `recordAttempt`). One test runs the real run.ts as far as it goes without a sandbox |

A request's objective picks what the stand-in does, with a marker such as `[flow:report]`:
`report`, `pr`, `verified`, `rejected`, `defer`, `defer-once`, `fail`, `crash`, `slow`
(`harness/scenarios.ts`).

## Safety

The suite drops and recreates its own databases (`agent_hq_flow*`) and flushes its Redis
database, so `FLOW_DATABASE_URL` and `FLOW_REDIS_URL` must point at this machine or a CI service
container; anything else is refused. It never reads `.env.local`: the worker, its jobs and
`next dev` get every database, queue and API variable from `harness/flow.ts` / `e2e/env.ts`, and
paid AI keys are set empty. (The production-database Playwright suite in `tests/e2e` only seeds
finished requests, which no worker picks up.)

The suite runs in `America/Los_Angeles` on purpose: timestamps are stored as zone-less UTC, so
anything that reads or writes them in local time shows up as an hours-off assertion
(`morning-report.flow.test.ts` caught one).

## Files

| File | Covers |
|---|---|
| `migration.flow.test.ts` | `npm run factory:migrate` on a pre-Phase-81 database lands on exactly what `db:push` creates; idempotent; cascade rules |
| `enqueue.flow.test.ts` | Run agent / skill launcher / advisor actions → row + event + job; guards (an open agent PR blocks its repo until merged or closed, failing CI or not); the weekly skill runs' repos; cancel, retry, run now, pause; Redis down; the Agents overview and its kept Redis connection; the API routes |
| `worker.flow.test.ts` | The worker end to end: report, PR, verified, rejected; deferral and retry; failure retries; crash; allowlist; cancelled jobs; queue pause; `PAUSE`; Run now + reconcile; pruning; live Agents data; SIGTERM mid-run; the real run.ts |
| `morning-report.flow.test.ts` | The morning report's Agent HQ lines against real rows, in a non-UTC zone: request outcomes, and the idle-factory check (skipped runs and the daily report don't count) |
| `e2e/*.spec.ts` | The browser: Agents page (worker, schedules, run now, traces, pause), Run agent from a repo's Agent tab to Report ready / PR Ready, cancel + retry, access for other users and signed-out visitors |

Set `FLOW_DEBUG=1` to print the worker's (and `next dev`'s) output. Without the Chromium that
matches `@playwright/test`, point `FLOW_CHROMIUM` at another Chromium binary.
