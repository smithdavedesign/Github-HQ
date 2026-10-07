# Agent HQ — Trade-offs of moving off the Render workers

> **Context:** roadmap Phase 81 moved agent execution from Nexus (AI-Took-My-Job: an API, a BullMQ
> worker, Redis and Postgres on Render, running paid Claude) to the factory worker on the owner's
> Mac. The decision and design are in [agent-hq-migration-prd.md](agent-hq-migration-prd.md); its §3
> lists the trade-offs accepted up front. This page is the assessment after the build (2026-10-07):
> what the move costs, what it buys, how to judge it, and what to do next.

## Verdict

The move is directionally right. Don't reverse it for the Nexus features it drops.

Nexus was an execution platform. The factory is becoming the product: RepoHQ decides what should
happen and keeps the record, and the worker is only where it happens. The Mac isn't "the factory".
It's worker #1, and it's replaceable.

The real costs are **availability** (everything waits for the Mac) and **model quality** (free models,
even for your own requests). Both are infrastructure limits you can buy or build your way out of.
The gains are architectural: one governed path, sandboxing, a judge, a trace of every step.

Run it as it is for a week before adding anything major. The [scorecard](#judging-the-trial-week)
then shows where the next dollar should go. The likely order is paid escalation for your own
requests, a healthier Mac, then always-on compute, ahead of any new agent roles.

## At a glance

| | Nexus on Render (before) | Factory worker on the Mac (now) |
|---|---|---|
| Runs | Always (a Render worker) | When the Mac is awake, logged in, on AC power, with Docker running |
| Pickup | Immediate, up to 3 tasks at once | Immediate when the worker is idle; one job at a time, and a request waits for a running job (a cycle can take 3 h) |
| Models | Paid Claude for every task | Free first (local Ollama, then a free cloud pool); requests never escalate to paid |
| Isolation | None: the agent and the repo's scripts ran on the worker, with its credentials | Docker sandbox: no credentials, no host mounts, allowlisted egress |
| Checks before a PR | None | The repo's checks before and after, Judge v2's rules, an adversarial review |
| Results (2026-10 audit) | 306 queued → 29 PRs → 2 merged | 24 attempts → 12 verified → 4 merged, $0 |
| PR author | The Nexus GitHub App | Your own GitHub account (`gh` on the Mac); fix requests open no PR until `owner-requested` is promoted |
| Follow-ups | Skill auto-chain, CI fixes on its own PRs, `/canary` | None of the three |
| Visibility | Nexus's own portal | The Agents page: requests, runs, step traces, the worker and the queue |
| Render services | 4 (web, worker, Redis, Postgres) | 1 (Redis) |

## Who does what now

| Part | Runs on | Does |
|---|---|---|
| RepoHQ (the app) | Vercel | Decides what should happen (advisor, health, Run agent, auto-dispatch); shows everything (the Agents page) |
| Neon | Neon | The record: requests, runs, step traces, tier attempts (`agent_jobs`), portfolio events |
| Redis (BullMQ) | Render | Wakes the worker; holds the schedules, live job progress and the worker's heartbeat |
| The factory worker | The Mac (worker #1) | Senses, ranks and routes; runs each job in the sandbox; verifies; opens the draft PR; keeps the ledger routing learns from |
| Docker sandbox, Ollama + LiteLLM | The Mac | Safe execution; the free workforce |
| GitHub | GitHub | Code and PRs. You review and merge |
| OpenClaw | The Mac | Plain-words asks, as requests |

**Replacing the worker is easy; running several at once is not.** Moving the worker to one always-on
host is a deployment change. Several workers at the same time (a Mac with local models plus a cloud
VM, say) need two things first:
- **The ledger moves to Neon.** Routing learns from `~/.repohq-factory/ledger.jsonl`, a file on the
  Mac. `agent_jobs` already mirrors it.
- **Each worker says what it can run.** For example, local models or cloud only. BullMQ can then
  hand each job to a worker that can run it, through one queue per capability.

That's the execution-provider step. It's worth doing when a second machine exists, not before.

## What it costs, most important first

| # | Cost | Severity | Stance |
|---|---|---|---|
| 1 | It only works when the Mac does | High | The one real architectural weakness: harden the Mac first, then get an always-on host |
| 2 | Weaker models for your own requests | High | Add opt-in paid escalation for requests you start |
| 3 | One job at a time, within the free quotas | Medium | Right for now; let a cycle yield to a request only if waiting gets annoying |
| 4 | No PRs at first | Low | Deliberate; promote on evidence |
| 5 | Features you lose | Medium | Fixed pipelines are safer; nothing to restore |
| 6 | The Mac is the single point of failure, and the ops burden | Medium | Health probes and self-restarts before new hardware |
| 7 | PR identity | Medium | A GitHub App identity is worth doing |
| 8 | Redis is the most optional piece | Low | Keep it through the trial; it's the easiest thing to drop later |

### 1. It only works when the Mac does

Asleep, lid closed, on battery, Docker Desktop stopped, logged out or travelling: nothing runs. The
worker is a LaunchAgent in your login session (`gui/<uid>`), so after a reboot it starts only when
you log in. Requests wait rather than fail. They stay `queued` with the reason shown on the Agents
page, and they're never re-routed to a paid model. But "Run agent" is no longer near-instant the way
it was on Render. The freshness banner (no finished run in 36 h) and the morning report (a request
waiting 48 h) flag a worker that has gone quiet.

What already makes the Mac behave like infrastructure:
- launchd restarts a worker that dies (`KeepAlive`).
- The heartbeat reports PAUSE, battery and Docker.
- On start and after every cycle, the worker re-queues any open request whose job went missing.
- A job cut off by sleep is re-queued once by BullMQ's stalled-job check. The worker re-reads the
  request row before running it, so a request that already finished isn't run twice.

*What helps:* recommendations 3 and 6.

### 2. Weaker models for your own requests

Requests run through the worker as unattended work (`factory/run.ts --scheduled`), and unattended
runs are forced to $0 (`scheduledPolicy`, `factory/lib/night-shift.ts`). Even with
`monthlyBudgetUsd` set, a request never escalates to paid Claude (tier M2); the paid budget applies
to manual CLI runs only.

Free models handle small, well-defined fixes well: types, lint, failing tests, docs, a scoped bug.
They're noticeably weaker on open-ended asks like "ship this feature", so expect more `rejected`
and `failed` outcomes there than Nexus's paid Claude gave you. Report requests (`/investigate`,
`/review`, `/qa-only`, `/health`, `/retro`) suffer less: they're read-only, judged on the report,
and open no PR.

For balance, Nexus's paid model didn't translate into merged work in practice: 306 queued tasks
became 29 PRs and 2 merges, against the factory's 4 merges from 24 attempts at $0
([audit-2026-10.md](audit-2026-10.md)).

*What helps:* recommendation 2, paid escalation for requests you start yourself.

### 3. One job at a time, within the free quotas

The worker runs one job at a time: Docker's VM and a resident 7B model share the Mac's 16 GB.
Requests already go ahead of scheduled work (queue priority 1 against 5), but they can't interrupt
the job that's running. A cycle can take up to 3 hours, a request up to 2. A request made at 23:10,
during the night shift, may wait for the cycle that started at 23:05.

That's the right default for now. The binding constraint is verified results, not throughput
([autonomous-factory.md](autonomous-factory.md) §14): one agent with a high chance of a good result
beats several racing on 16 GB.

Free-tier quotas also cap the day's work. The free cloud pool spans Ollama Cloud, OpenRouter and
Gemini's free tiers, each with its own daily limit. OpenRouter's is about 50 requests at $0 credit,
and one Claude Code task spends 10–30. When the pool runs dry, the factory defers instead of paying
([factory/README.md](../factory/README.md), "Free-tier facts"). A one-time $10 OpenRouter credit
raises its free limit to 1,000 requests a day.

*What helps:* recommendation 7 if waiting behind a cycle gets annoying. Concurrency 2 is already
planned once the night shift passes its gate (roadmap Phase 80).

### 4. No PRs at first

Fix requests end `verified` — judged and held, no PR — until you promote `owner-requested` from
`report` to `pr` in `factory/factory.config.json` (the promotion ladder, roadmap Phase 75). That's
deliberate while the judge is being calibrated, but the first week's fix requests produce evidence,
not PRs.

*What helps:* recommendation 5.

### 5. Features you lose

| Lost | Why | Instead |
|---|---|---|
| Automatic follow-on skills (`suggestedNextSkill` auto-chain) | Spawning depth stays 1 ([autonomous-factory.md](autonomous-factory.md) §14.1, decision 2): fixed pipelines are safer than dynamic chains | Findings still suggest a next skill; you queue it |
| The agent fixing CI on its own open PRs | The judge runs the repo's checks before any PR opens | A PR that still fails CI is flagged `needs human`, with a notification |
| `/canary` | The sandbox has no browser and no live network access | — |
| Nexus's full gstack skills: learnings, checkpoint mode, the brief in `CLAUDE.md`, the skill router (G1–G6) | They ran Claude Code with gstack's scripts on the Render worker | Each skill is prompt guidance inside the factory's fix or report task (`factory/lib/tasks.ts`) |

### 6. The Mac is the single point of failure, and the ops burden is yours

Render ran Nexus's machine. Now you keep the worker's running:
- the LaunchAgent;
- the keychain entries (`repohq-factory-database-url`, `repohq-factory-redis-url`);
- Docker Desktop: updates, restarts, its VM disk;
- disk space: about 2 GB of sandbox images, plus logs and clones in `~/.repohq-factory`;
- the local AI stack: Ollama and LiteLLM, which the weekly model scout restarts.

*What helps:* recommendation 3. Squeeze more reliability out of this Mac before buying another one.

### 7. PR identity

Factory PRs are opened with `gh pr create` on the Mac (`factory/lib/git.ts`), so your own GitHub
account authors them, not a bot identity like the Nexus GitHub App. They're still recognizable by
branch (`feature/bot/factory-…`) and labels (`owner-requested`, `needs-careful-review`), but not by
author. Your human PRs, commits and reviews mix with the factory's. And GitHub doesn't let you
approve a PR you authored, so a branch rule that requires an approving review can't be met for
factory PRs without an admin bypass.

*What helps:* recommendation 4.

### 8. Redis is the most optional piece

Neon holds every request; Redis carries only their ids. Redis buys:
- instant pickup;
- the schedules;
- live job progress;
- the worker's heartbeat;
- the queue view on the Agents page.

The cost is a paid Render service (`plan: starter` in `render.yaml`) and an endpoint open to the
internet behind its password and TLS. The exposure is small. Jobs carry only ids, and the worker
trusts Neon, not Redis: it claims only the owner's open requests and re-checks the allowlist. A
leaked `REDIS_URL` could pause or flood the queue, or trigger extra (sandboxed, $0) cycles, but it
can't make the worker run anything you didn't ask for.

At today's scale (one worker, a handful of requests a day) Redis mainly makes the system feel
real-time, and the queue would work without it. But dropping it isn't free. The worker requires
`REDIS_URL` today, and a Neon poll has its own cost (recommendation 8).

*What helps:* recommendation 8, after the trial week, if Redis's cost or the open endpoint bothers you.

## What it buys

- **One governed path for all agent work.** Every request goes through the same sandbox, judge and
  adversarial review, whatever its source: Run agent, the skill launcher, Monday auto-dispatch, MCP
  or OpenClaw. Every step is traced and visible on the Agents page.
- **$0 by default instead of paid, unsandboxed Claude.** Four Render services shrink to one.
- **One repo** for the app, the factory and the queue, and one place to see everything.
- **A replaceable worker.** It's a plain Node process with a Redis URL and a database URL.
  Moving it is a deployment change, not a rewrite.

## Judging the trial week

Nexus stays suspended during the trial, so this isn't a live A/B test. It compares the factory's
week with what Nexus recorded before cutover. Judge it on PRs produced per dollar and per minute of
your time, not on architecture diagrams.

| Metric | Where it comes from | Nexus before cutover |
|---|---|---|
| Requests and their outcomes (pr, verified, reported, rejected, failed) | `agent_requests`; the Agents page; the morning report's Agent HQ line | 306 queued |
| PRs opened → merged | `agent_jobs` (outcome, `pr_url`) | 29 → 2 |
| Time to pick up and to finish | `agent_requests`: `created_at` → `claimed_at` → `resolved_at` | Not recorded |
| Time spent waiting for the Mac | Deferral reasons on requests; skipped runs | — (always on) |
| Your time | PRs you had to edit (`agent_jobs.human_commits`), review hours (factory KPIs) | Not recorded |
| Free-model requests | `agent_jobs.requests`; the KPI "merged per 100 free requests" | — (paid) |
| Cost | `agent_jobs.cost_usd`; the morning report's month to date | Anthropic API spend, not recorded per task |
| Verification failures | Judge rejections (`agent_jobs` status and reason) | — (no judge) |

## What to do about it

| When | # | Recommendation | Addresses |
|---|---|---|---|
| At cutover | 1 | Keep Nexus suspended, not deleted, for the trial week, and keep the scorecard | Rollback, evidence |
| After the trial week | 2 | Opt-in paid escalation for requests you start | Cost 2 |
| | 3 | Health probes and self-restarts on the Mac; reconcile on wake | Costs 1, 6 |
| | 4 | A GitHub App identity for factory PRs | Cost 7 |
| | 5 | Promote `owner-requested` to `pr` once verified results earn it | Cost 4 |
| If it gets annoying | 6 | An always-on host | Costs 1, 3, 6 |
| | 7 | Let a cycle yield to a waiting request | Cost 3 |
| | 8 | Drop Redis for a Neon poll | Cost 8 |

**1. Keep Nexus suspended for the trial week.** This is already the runbook. Suspend at cutover
(PRD §11, step 4) and delete only after a week of clean runs (step 6). Until then, rollback is
reverting the merge, restoring the three `NEXUS_*` variables and un-suspending two services. Keep
the scorecard above from day one.

**2. Paid escalation for requests you start.** Split the work into two modes:

```text
autonomous work                         requests you start
(night shift, Monday auto-dispatch,     (Run agent, the launcher,
 weekly health and retro)                MCP, OpenClaw)
        │                                        │
        ▼                                        ▼
   $0, always                        local → free cloud → paid
   (local, then free cloud)          (paid only when the free tiers
        │                             fail, within a per-request
        │                             ceiling and a monthly cap)
        │                                        │
        └─ the same sandbox, judge and PR gate ──┘
```

Requests you start are explicit intent. Letting them, and only them, escalate to Claude would
recover most of Nexus's quality on harder asks without touching the $0 economics of the night shift.

The change is small and contained:
- **Today:** `scheduledPolicy` zeroes the budget for every `--scheduled` run.
- **The change:** request runs from any source except `auto-dispatch` would keep a request budget
  instead. That's a per-request ceiling (for example $2) inside a monthly cap, with new keys in
  `factory.config.json`, default 0. The sandbox's model relay would then allow the paid model for
  that run.
- **What stays:** the router still tries the free tiers first and escalates only when an attempt
  fails, so paid models spend only on what free ones couldn't do. The sandbox, the judge and the
  draft-PR gate are unchanged.

**3. Health probes and self-restarts.** Make the Mac feel like infrastructure before replacing it:
- **Probes:** add LiteLLM, Ollama, Neon and GitHub reachability to the heartbeat, and show them
  on the Agents page.
- **Self-restarts:** restart LiteLLM when it's down (the scout already knows how) and start Docker
  Desktop when Docker isn't running.
- **Reconcile on wake:** reconcile when the Mac wakes, not only at start and after cycles.

Today a dead LiteLLM shows up in the morning report's Ops section and as requests deferring every
30 minutes ("LiteLLM gateway is down"), but not on the Agents page.

**4. A GitHub App identity.** Reuse the Nexus GitHub App (renamed) or register a new one, installed
only on the allowlisted repos with write access to contents and pull requests. The worker mints an
installation token on the host. The sandbox never sees it, just as it never sees your `gh` login
today. Factory PRs then come from the bot, you can approve them, and the history separates cleanly:
your PRs, commits and reviews are yours, and the bot's are the factory's. This is roadmap Phase
66's open item. The Nexus app lives on GitHub, not Render, so retiring Nexus's services doesn't
remove it.

**5. Promote `owner-requested`.** Once a handful of fix requests have ended `verified` with diffs you
would have merged, set `capabilities.owner-requested` to `pr` in `factory/factory.config.json`. The
morning report's Director section shows the evidence for each capability. Merging stays human
([autonomous-factory.md](autonomous-factory.md) §14.1, decision 8). The factory learns from what
you accept; it doesn't route around it. A confidence threshold that lets some verified results
open PRs on their own can come later, from that data.

**6. An always-on host.** A Mac mini at home keeps the local models and the whole AI stack. A cloud VM
also works, with two limits:
- It needs Docker for the sandbox. Render workers can't run Docker, which is why the worker isn't
  on Render.
- Without a GPU it can't run the local models usefully, so it would lean on the free cloud pool.

On Linux the worker skips the AC-power check and `caffeinate`; nothing else changes
([autonomous-factory.md](autonomous-factory.md) §8, "Later: the AI dev VM"). A second machine
alongside this one needs the steps under [Who does what now](#who-does-what-now).

**7. Let a cycle yield to a waiting request.** If waiting behind a 3-hour cycle gets annoying, let
the cycle stop between repos when a request is waiting. The next cycle re-ranks everything anyway,
so there's nothing to save or resume. A fuller priority ladder (urgent, owner, CI failure,
production issue, maintenance, low value) can come later, if the queue ever has real contention.

**8. Drop Redis.** It's the easiest piece to remove, if its Render cost or the open endpoint matters
more than instant pickup and the live queue view. The work:
- **Pickup:** a Neon poll, every 30–60 seconds.
- **Schedules:** back to launchd's calendar, as before Phase 81.
- **Heartbeat:** somewhere else, or nowhere.

The catch is Neon's compute. A poll that frequent keeps it awake whenever the worker runs, where it
would otherwise scale to zero after 5 idle minutes. The PRD chose Redis partly to avoid that
([PRD](agent-hq-migration-prd.md) §6, §13). Polling less often than its 5-minute idle timeout (say every
10 minutes) lets Neon sleep, at the price of pickup taking minutes. Bring Redis back if there are ever several workers or real-time
dispatch to coordinate. Don't build for a scale you don't have.

## The operations view

Most of a factory control panel already exists:

| Question | Where today |
|---|---|
| Is the worker up? PAUSE, battery, Docker? | The Agents page: worker status, from the heartbeat |
| What's running, and which step? | The Agents page: the active job and its live step |
| What's queued? | The Agents page: waiting, active, delayed, failed, completed |
| What ran last night, and how did it end? | The Agents page: recent runs and requests with their traces; the morning report email |
| PRs, acceptance, review load | Factory KPIs on the Agents page; the morning report |
| What did it cost? | The morning report: paid spend this month |

What's missing:
- LiteLLM and Ollama health (recommendation 3).
- How long the current job has run. The heartbeat records its start; the panel doesn't show it.
- A one-line "last night" summary at the top of the page.
- A way to ask from OpenClaw or Claude Code. A `get_factory_status` MCP tool over the same overview
  would answer "How did the factory do last night?"
