# Agent HQ — One Agent System (Nexus migration PRD)

> **Status:** approved 2026-10-06; code complete 2026-10-07 on `claude/great-bardeen-n6sksa` (roadmap [Phase 81](roadmap.md#phase-81--one-agent-system-nexus-migration-code--cutover-pending)). The owner cutover (§11) is pending.
> **Decision source:** [audit-2026-10.md §9.1](audit-2026-10.md#9-worth-discussing) ("one executor"), decided by the owner on 2026-10-06.
> **Scope:** this repo only. `AI-Took-My-Job` (Nexus) gets no commits. It is archived after cutover (§11).

---

## 0. TL;DR

Right now two systems write code. One is **Nexus**: paid Claude, unsandboxed, running on Render behind a Fastify API and BullMQ. The other is **the factory** in `factory/`: a Docker sandbox, Judge v2, free-first routing and a ledger. This PRD makes the factory the **only** executor and moves the infrastructure Nexus provided (a Redis-backed BullMQ queue and its worker) into this repo. Nexus's product surfaces are not brought over: widget, customer portal, Chrome extension, `/learn` pages, replay, shadow suites.

- RepoHQ's "Run agent", the gstack launcher, Monday auto-dispatch and the MCP `queue_gstack_skill` tool all stop calling Nexus. Instead each one writes an **`agent_requests` row** in Neon and adds a **BullMQ job** to a Redis queue defined in this repo's `render.yaml`.
- **`factory/worker.ts` is the BullMQ worker.** It runs on the Mac, kept alive by launchd, and replaces both the Nexus worker and the factory's launchd calendar. Scheduled cycles, the morning report and the weekly scout become BullMQ job schedulers. They are visible in the UI and can be run on demand.
- Every run writes **`automation_runs`** and **`trace_events`**. Both factory jobs and the Vercel crons are covered. A new **Agents** page shows the queue, the schedulers, the requests and a step-by-step trace of what each agent did.
- Neon stays the one database and the source of truth. Redis is transport plus scheduling. If Redis is lost, nothing is lost: the worker re-queues pending rows from Neon.

## 1. Problem

| Today | Why it hurts |
|---|---|
| Two executors | Two queues, two sets of failure modes, two PR identities. Nexus's success rate is low, and its failures dominate the feed's noise (audit §7) |
| Nexus runs paid Claude, unsandboxed, on Render | Repo code and the agent run with credentials in the same environment. Every run costs money. Render bills four services (web, worker, Redis, Postgres) |
| The factory's front door (#17) is a local JSONL file | Vercel can't reach it, so RepoHQ's UI can only dispatch to Nexus |
| Agent visibility is split | Nexus's execution timeline lives in its own server-rendered UI. RepoHQ sees only the events Nexus chose to post back |
| Automation is invisible | The crons stopped for seven weeks unnoticed (audit item 2). The factory's schedule lives in launchd plists on one Mac |

## 2. Goals and non-goals

**Goals**
1. **One executor.** The factory is the only code path that writes code or opens PRs. Every request goes through the same sandbox, judge and ledger.
2. **One repo, with spawning kept separate.** `src/` (Vercel) never runs an agent. `factory/` (the worker) never serves UI. They share only the Neon schema and the queue contract.
3. **Migrated infrastructure.** The Redis/BullMQ queue and worker deployment are defined in this repo (`render.yaml`, `docker-compose.yml`, `factory/worker.ts`).
4. **Observable automation.** One page answers "what is queued, what is running, what ran, and what exactly did it do?" for agent jobs and scheduled automation alike.
5. **No regressions in the learning loop.** Advisor accuracy, lifecycle badges, PR-merge detection and skill findings keep working with requests as the new source.

**Non-goals**
- No Nexus code or UI is copied: no widget, portal, extension, `/learn`, review queue, replay, shadow suites, Notion ledger, Terraform or Fastify. Everything here is written fresh against this repo's conventions.
- No cloud code-writing lane. The worker needs Docker for its sandbox and the local LiteLLM/Ollama stack, and Render workers can't run Docker. A later move to a Docker-capable VM is a deployment change (§13).
- No change to the factory's judge, routing, promotion ladder or budget rules.

## 3. Decisions and trade-offs

| Decision | Trade-off accepted |
|---|---|
| The factory is the only executor | "Run agent" waits for the Mac: while it's asleep or on battery, requests queue. They are **never** silently re-routed to a paid model |
| BullMQ on Redis for transport and scheduling, Neon for state | One more secret (`REDIS_URL`) and one small Render service. In return, pickup is instant and schedules are visible and editable as config |
| Requests run as **unattended** work | Same rules as scheduled cycles: sandbox required, $0 budget, ≤ 1 PR per repo, never auto-merged |
| `owner-requested` stays at stage `report` | Fix requests are verified but open no PR until the owner promotes the stage to `pr` in `factory/factory.config.json` (promotion ladder, Phase 75) |
| gstack skills map to two modes | `fix` (draft PR) for `ship`, `qa`, `document-release`. `report` (read-only findings) for `review`, `qa-only`, `health`, `investigate`, `retro`. `canary` is dropped because the sandbox has no browser and no live egress |
| Skill auto-chain (`queueSuggestedSkill`) removed | Spawning depth stays 1 (autonomous-factory §14.1 decision 2). Findings still suggest next steps for the owner to queue |
| CI-fix-on-existing-branch loop (`queueCIFix`) removed | The judge runs the repo's checks before any PR opens. CI failing on an agent PR becomes a notification (`agent_needs_human`), not another agent run |
| GitHub Actions stays the canonical cron trigger | The Vercel cron routes are traced (§9) but not re-scheduled in BullMQ: the Mac isn't always on, and `AGENTS.md` forbids duplicate schedules |

## 4. Target architecture

```
                         ┌──────────────────────────── Github-HQ (one repo) ────────────────────────────┐
 Owner ──▶ RepoHQ UI ───▶│ src/  (Vercel)                                                               │
 MCP   ──▶ (Next.js)     │   enqueueRequest(): insert agent_requests ─┐                                 │
 Digest cron (Mon)       │                     add BullMQ job ────────┼──▶ Redis (render.yaml)          │
                         │   Agents page ◀── Neon (requests, runs, traces, agent_jobs) + Redis (counts) │
                         │                                            │        │ job {requestId}         │
                         │ factory/ (Mac, launchd KeepAlive)          ▼        ▼                         │
                         │   worker.ts ── load request from Neon ──▶ runCycle() ──▶ sandbox → ladder →   │
                         │                                         judge → draft PR / findings          │
                         │              ── write status · automation_runs · trace_events · agent_jobs   │
                         └──────────────────────────────────────────────────────────────────────────────┘
```

| Component | Where | Responsibility |
|---|---|---|
| RepoHQ app (`src/`) | Vercel | Guards (lifecycle, allowlist, skill policy), enqueue, status, Agents UI. Never executes agents |
| Queue contract (`factory/lib/queue.ts`) | Shared module | Queue name, job names, payload types, lazy connection. Imported by both sides |
| Redis | Render Key Value (`render.yaml`), dev via `docker-compose.yml` | BullMQ transport, schedulers, live job progress, worker heartbeat |
| Worker (`factory/worker.ts`) | Mac, launchd `KeepAlive` | One job at a time. Request, cycle, scout and report jobs. Gates (PAUSE, AC power, lock) |
| Factory pipeline (`factory/run.ts` and `lib/`) | Mac + Docker sandbox | Unchanged pipeline, now callable per job (`runCycle`) and traced |
| Neon | Existing | Source of truth for requests, runs, traces, attempts and events |

## 5. Data model (Neon, `src/lib/db/schema.ts` + `factory/sql/0002_agent_hq_queue.sql`)

**`agent_requests`**: one row per request, from any source.

| Column | Notes |
|---|---|
| `id` text PK | UUID. Also the BullMQ `jobId` and the `taskId` on every related `portfolio_events` row |
| `user_id`, `repo_id?`, `repo` | `repo` is `owner/name`; it must be on the factory allowlist |
| `mode` | `fix` \| `report` |
| `skill?`, `objective` | The gstack skill it came from (for the UI), and the owner's or advisor's objective |
| `source` | `ui-advisor` \| `ui-skill` \| `auto-dispatch` \| `mcp` \| `openclaw` |
| `status` | `queued` → `running` → `pr` \| `verified` \| `reported` \| `rejected` \| `failed`. Also `queued` → `cancelled`, and `running` → `queued` (deferred: free quota out, or on battery) |
| `pr_url?`, `findings?`, `reason?` | The outcome |
| `run_id?`, `attempts` | The factory run that served it, and how many times it was picked up |
| `created_at`, `claimed_at?`, `resolved_at?`, `updated_at` | |

**`automation_runs`**: one row per automated run, the heartbeat for everything scheduled.
`id`, `user_id`, `kind` (`factory-cycle` \| `factory-request` \| `factory-scout` \| `factory-report` \| `cron:sync` \| `cron:digest` \| `cron:security` \| `cron:deployments` \| `cron:ai-summary`), `trigger` (`schedule` \| `manual` \| `request`), `request_id?`, `started_at`, `finished_at?`, `status` (`running` \| `ok` \| `skipped` \| `failed`), `summary` (jsonb), `error?`.

**`trace_events`**: the step timeline.
`id`, `run_id` (→ `automation_runs`), `request_id?`, `job_id?` (→ `agent_jobs`), `at`, `step`, `status` (`start` \| `ok` \| `fail` \| `info`), `detail`, `data` (jsonb), `duration_ms?`. Rows are kept for 90 days; the daily report job prunes older ones.

**`agent_jobs.request_id`**: links each tier attempt (and escalation chain) to the request it served.

## 6. Queue and worker design

- **One queue, `factory`, concurrency 1.** On a 16 GB Mac the Docker VM and a resident 7B model allow one job at a time (factory README, "Sandbox").
- **Job names:**
  - `request` {requestId}, priority 1
  - `cycle`, `report`, `scout` {trigger}, priority 5
  - Unknown names are rejected.
- **Payloads carry IDs only.** The worker loads the request from Neon and re-checks the allowlist, so anyone with Redis access can't inject an objective.
- **Schedulers** are read from `schedules` in `factory/factory.config.json`, using the Mac's time zone. They reproduce the launchd calendar:

  | Job | Schedule |
  |---|---|
  | `cycle` | :05 at 20:00–06:00, 12:00 and 16:00 |
  | `report` | 06:45 |
  | `scout` | Sunday 17:10 |

  The worker upserts them on start and removes schedulers that are no longer configured. Missed slots coalesce into one run on wake, as launchd does now.
- **Gates checked before each job:**
  - The `PAUSE` file or a paused queue: wait.
  - Battery power, unless `FACTORY_REQUIRE_AC=0`. A scheduled cycle is skipped and traced. A request is delayed 15 minutes, and the UI shows "waiting for AC power".
  - The factory lock (a manual CLI run in progress): delay 5 minutes.
  - `caffeinate -ims` runs for the duration of each job only.
- **`request` jobs:**
  1. Mark the row `running`.
  2. Run `runCycle({ repo, request })`. `fix` goes through the existing `owner-requested` path. `report` goes through a read-only investigation that generalises today's red-ci `investigate()`.
  3. Write the terminal status and the events.
  4. If the result is `deferred`, the row returns to `queued` and the job is re-delayed.
- **Reconcile.** On worker start and at each scheduled cycle, rows that are `queued` with no job, or `running` with no active job, are re-added (idempotent, because `jobId` = request ID). This also covers enqueues whose Redis call failed.
- **The JSONL front door stays.** OpenClaw requests are mirrored into `agent_requests` (`source: openclaw`) when picked up, so they appear in the UI and the trace.
- **Heartbeat.** The worker writes a small status hash to Redis (host, pid, started, last seen, paused, on AC, Docker up). Nothing polls Neon on a timer, which keeps Neon's compute free to scale to zero.

## 7. Request lifecycle in RepoHQ

`getRepoLifecycle` (repo Agent tab, Run-agent buttons) reads the **request row** for factory tasks and the existing events for older Nexus tasks:

| Request status | Lifecycle stage | Blocks a new request on the repo? |
|---|---|---|
| `queued` | `queued` | yes |
| `running` | `running` | yes |
| `pr` | `pr_ready`, then `merged` / `rejected` / `ci_failing` / `needs_human` from PR events | while open |
| `verified` | `verified` (new: "Verified, held at stage report") | no |
| `reported` | `report_ready` | no |
| `rejected`, `failed` | `failed`, with the judge's reason | no |
| `cancelled` | `idle` | no |

The factory writes the same `portfolio_events` RepoHQ already consumes, each keyed by `taskId = request.id`:
- `agent_pr_created` feeds the PR-merge checker, actual deltas and advisor accuracy.
- `agent_skill_report` (findings) feeds the findings preview and the MCP `get_skill_findings` tool.
- `agent_execution_failed` feeds the feed and stats.

The 15-minute lifecycle timeout applies only to legacy Nexus tasks.

## 8. Skills to modes

| Skill | Mode | Factory behaviour |
|---|---|---|
| `ship` | fix | Owner-requested change, labelled draft PR |
| `qa` | fix | "Find and fix bugs; keep every check passing" |
| `document-release` | fix | Docs, README and CHANGELOG only; no functional code |
| `review`, `qa-only`, `health`, `investigate`, `retro` | report | Read-only investigation on the free pool. A structured report (findings, evidence, suggested next step) is parsed into the findings list |
| `canary` | — | Removed (needs a browser and live egress) |
| Advisor action ("Run agent") | fix (report for security actions) | The objective is the advisor's action plus its reasoning |

## 9. UI requirements: the Agents page

`/agent-performance` becomes **Agents**. The route is kept and the nav label changes. The factory KPIs stay at the bottom. Data refreshes every 15 seconds with TanStack Query through session-guarded GET routes.

1. **Automation**, a Bull-Board-style panel:
   - **Worker:** online or offline (Redis heartbeat), host, last seen, PAUSE, AC power, Docker.
   - **Queue:** waiting / active / delayed / completed / failed counts.
   - **Schedulers:** each with its pattern, time zone and next run.
   - **Recent runs:** factory jobs and the five Vercel crons together, with trigger, status, duration and a summary.
   - **Owner-only controls:** Run now (cycle / report / scout), Pause / Resume the queue, Retry a failed job.
   - If Redis isn't configured or is unreachable, the panel says so and still shows the Neon data.
2. **Requests:** newest first.
   - Columns: repo, mode/skill, source, age, status badge, then the PR link, expandable findings, or the reason.
   - **Cancel** on queued rows.
3. **Trace:** click any request or run to see its timeline.
   - Steps: claimed → sense → clone → sandbox install → baseline checks → task → tier attempt (model, requests, tokens) → judge verdict → adversary verdict → PR / findings → resolved, each with status, duration and detail.
   - The `agent_jobs` attempt rows sit inline. The active job shows live BullMQ progress.
4. **Freshness:** the dashboard banner and the morning report also flag "factory worker hasn't completed a job in 36 h" (audit §9.4).

The factory controls show only for the owner (`session.user.id === FACTORY_USER_ID`). A repo's "Run agent" is enabled only when it's on the allowlist; otherwise the button explains why.

## 10. Security

- **Redis** is a Render Key Value reachable from outside Render (Vercel has dynamic IPs), so it requires both auth and TLS. Because payloads are IDs and the worker trusts only Neon rows that pass the allowlist, a leaked `REDIS_URL` can trigger at most an ordinary cycle. It cannot inject a task.
- **Prompts never see secrets.** Neither `REDIS_URL` nor `DATABASE_URL` enters the sandbox: the worker's per-command environment is overrides-only (Phase 76).
- **Owner checks** on every queue-control server action (`'use server'`, user derived from the session). Functions that take a userId live in `server-only` modules (`AGENTS.md`).
- **Prompt injection** in an objective still yields at most a sandboxed, judged, human-reviewed draft PR (autonomous-factory §14.1 decision 11).

## 11. Rollout and cutover runbook (owner)

**1. Ship this repo's change**
1. Merge the PR.
2. `npm run db:push` and `npm run factory:migrate`, which applies `0002`.

**2. Infrastructure**
1. Render → New Blueprint from this repo, which creates `agent-hq-redis`.
2. Copy its external URL. In Vercel set `REDIS_URL` and `FACTORY_USER_ID`, then redeploy.

**3. Mac**
1. `bash factory/bin/install-launchd.sh`. It stores `REDIS_URL` in the keychain on first run, replaces the three calendar plists with `com.repohq.factory.worker`, and starts the worker.
2. Check the Agents page: the worker is online and the schedulers are listed.

**4. Cutover**
1. In Vercel, delete `NEXUS_API_URL`, `NEXUS_API_TOKEN` and `NEXUS_WEBHOOK_SECRET`.
2. In Render, **suspend** `ai-devops-nexus-worker` and `ai-devops-nexus-web`.
3. Tasks still in flight on Nexus at cutover are abandoned; nothing waits on them.
4. Close the stale Nexus bot PRs (audit §8). Until they are reviewed or closed, the factory opens no new PRs on those repos (`blockOnStaleBotPrs`).

**5. Verify**
1. Run agent on an allowlisted repo, a `report` skill first: it goes queued → running → reported, with a full trace.
2. Then a fix request: it goes running → verified (held at `report` stage).
3. Promote `owner-requested` to `pr` when the verified results look right.

**6. Retire (after about a week of clean runs)**
1. `pg_dump` the Nexus Postgres from `ai-devops-nexus-db`'s external URL.
2. Delete the four Nexus Render services (web, worker, Redis, Postgres).
3. Archive `smithdavedesign/AI-Took-My-Job` on GitHub.
4. Remove it from the `repos` list in `factory.config.json`.

**Rollback** (before step 6): re-set the three `NEXUS_*` variables, un-suspend Render, and revert the PR.

## 12. Success metrics

| Metric | Target | Where |
|---|---|---|
| Calls to Nexus after cutover | 0 | Vercel logs; no `NEXUS_*` env |
| Pickup latency (queued → running) while the worker is online | ≤ 1 min (p95) | `agent_requests.claimed_at − created_at` |
| Jobs with a complete trace (claimed → resolved) | 100% | `trace_events` |
| Requests resolved within 24 h, Mac on AC | ≥ 90% | Agents page |
| Render services for agents | 1 (Redis), down from 4 | Render dashboard |
| Silent automation stalls | 0 | Freshness banner + morning report |

## 13. Risks and mitigations

| Risk | Mitigation |
|---|---|
| Redis lost or unreachable | Neon is the source of truth. The worker reconciles queued and running rows on start and at every cycle |
| Mac off for days | Requests wait (visible, with age). The freshness banner flags the idle worker. Moving the worker to a Docker-capable VM later is deployment only |
| Free models are weaker on free-form asks than paid Claude | The judge gates every change. M2 runs only with `monthlyBudgetUsd > 0`. Findings mode lets a report come first |
| A stuck job blocks the queue | Every command in the sandbox has a timeout, and the container lives at most 90 minutes. BullMQ's stalled-job detection re-queues jobs from a dead worker |
| Neon compute cost from polling | No timer polling of Neon. The heartbeat goes to Redis, and reconcile piggybacks on cycles |
| The lifecycle UI says "timed out" while waiting | Factory tasks use the request row, not the 15-minute event timeout |

## 14. What is removed from this repo

As built (2026-10-07):

- `src/lib/agents/nexus-dispatch.ts`, `src/lib/actions/nexus.ts` (now `src/lib/actions/agent-queue.ts`), and `src/app/api/webhooks/agent-events/route.ts`. The skill policy in `src/lib/actions/nexus-utils.ts` moved to `src/lib/skills/skill-policy.ts`.
- The Nexus polling in `src/app/api/agent-task-status/route.ts`, the "Open Nexus" links, and the `NEXUS_*` env vars (and the Nexus-worker gstack settings) in `.env.example`.
- `queueSuggestedSkill` (auto-chain) with `src/lib/skills/chain-continuity.ts`, and `queueCIFix`.
- The Nexus-only tests (integration, output contract, automated flow, webhook auth, skill chain, CI feedback loop, and two e2e specs).
- The "Nexus" lines in the dashboard agent cards and in the morning report (now Agent HQ request outcomes). Historical Nexus events stay in `portfolio_events` and still count in accuracy history; their lifecycle is still projected from events.

Kept on purpose: `nexus/*` in the bot-branch patterns (the open Nexus PRs are still bot PRs), the `.nexus/` ignore, and the manual `tests/integration/gstack-*.sh` scripts (they call the Claude CLI directly and depend on nothing in Nexus).
