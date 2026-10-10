# System overview: the big picture

> Read this first. It's the map of the whole system, for the owner and for any AI agent starting
> cold on one of its repos. Agents get it through the `portfolio-context` skill or the RepoHQ MCP tool
> `get_system_overview`. Updated 2026-10-10.

## The goal

**Make things people use and pay for, with near-zero overhead for the owner and no financial risk.**

A local AI stack knows the owner's repos, interests and ideas. It researches product ideas, reviews
them, cheaply tests demand, builds the ones that show signal, keeps every repo healthy, and tracks
what actually earns money. The owner's job shrinks to deciding: merge or close a PR, Build or Pass
an idea.

## The loop

```
             ┌──────────────────── context index (repos · ideas · bookmarks · docs) ────────────────────┐
             ▼                                                                                          │
  research (daily) ─▶ gstack review ─▶ demand test ($0 landing page) ─▶ build M1 (tests first) ─▶ live ─┼─▶ revenue (MRR)
     Claude Pro          validate/pass      14 days, visitors+signups        draft PR, owner merges       │      tracked in RepoHQ
     → free models                                                                                        │
             ▲                                                                                          │
             └──── RepoHQ health + factory: keep every repo working (lint, types, tests, deps, docs) ◀───┘
```

| Stage | What happens | Who decides | Cost |
|---|---|---|---|
| Research | One idea a day, sourced (no URL, no claim), checked against the owner's portfolio and interests | the pipeline | $0 (Claude Pro subscription, free models as fallback) |
| Review | gstack office-hours Six Forcing Questions, premise challenge, alternatives; CEO scope reduction; eng feasibility of M1 | the pipeline, policy on top; **the owner can override in Notion** | $0 |
| Demand test | A public landing page with a waitlist and a launch post the owner may share; 14 days | the numbers (`policy.json`) | $0 (Vercel Hobby) |
| Build | M1's exit criteria become tests first, then the code; a draft PR in the idea's private repo | **the owner merges** | $0 |
| Live and earning | RepoHQ tracks lifecycle, health and MRR; the factory keeps it healthy | the owner | free tiers until it earns |

## Where everything lives

| Part | Where | What it is |
|---|---|---|
| **RepoHQ** | `smithdavedesign/Github-HQ` (public), https://repohq.vercel.app | Portfolio dashboard: health, lifecycle, revenue, decision states. Hosts the idea signal endpoint and the MCP server. [Architecture](architecture.md) |
| **Factory** | `factory/` in this repo; runs on the owner's Mac (launchd worker, BullMQ via Render Redis) | Free-model-first maintenance: sandboxed fixes judged by checks, build and preview smoke; draft PRs the owner merges. [Design](autonomous-factory.md), [operator guide](../factory/README.md) |
| **Idea pipeline** | private repo `idea-factory` (`~/idea-factory`), Notion **Idea Board**, public landing pages on the `idea-pages` Vercel project | Research → review → demand test → build → revenue; git holds every idea in full. [Idea factory](idea-factory.md) |
| **Context index** | `factory/context/`, built daily into `~/.repohq-factory/context/index.json` | One searchable view of repos, ideas, bookmarks and docs, tagged by data class |
| **Resource Center** | private repo `resource-center` (`my-bookmarks-hub` on Vercel, behind Vercel auth) + the Bridge Chrome extension | The owner's bookmarks as a knowledge source; feeds interests into the context index |
| **Local AI stack** | `~/ai-stack` (local git) | Ollama, LiteLLM (model aliases and the free pool), Headroom, coding agents. [AI stack docs](ai-stack/README.md) |
| **OpenClaw** | `~/.openclaw` | `companion` (personal memory; reachable on **WhatsApp** and **Slack**), `scout` (idea research fallback, no personal context), `main` |
| **Slack** | workspace channel **#team-agents** (app `repoHQ-message`, socket mode through OpenClaw) | The communication layer: talk to the companion (@-mention in the channel, or DM), and where **system alerts** land: failures, reminders, recoveries |
| **System log** | `~/.system-events/events.jsonl` → collector (launchd, 5 min) → Neon `system_events` | One log across every part, with probes and Slack alerts. [Logging](logging.md) |
| **Backups** | private GitHub repos | `ai-stack` (the stack's config and scripts, never `.env`), `repohq-factory-state` (the factory's ledger and reports, nightly), `idea-factory` (every idea's record). Code repos live on GitHub. |
| **Secrets** | macOS keychain + `~/ai-stack/bin/secrets` | One source of truth; `check` runs daily; `rotate litellm` updates every copy. [Authentication](ai-stack/authentication.md) |
| **Notion** | Idea Board, task boards | Where the owner decides on ideas |

## Rules every part follows

- **Money:** $0 by default. Free tiers only (Vercel Hobby, Neon free); no paid domains, ads or services
  before an idea earns more than it costs (`idea-factory/policy.json`). A review that needs spending is a pass.
- **Models:**
  - Claude work runs on the owner's **Claude subscription** through headless Claude Code, never API
    credit.
  - **A local tier advisor rates every coding task 1–3** (routine / moderate / advanced) to pick the starting model. It earns that control on the promotion ladder; until then it only advises. Fallbacks stay deterministic rules.
  - **Building an idea from its PRD is Claude first:** Claude Code on the subscription, with LiteLLM's free
    pool only as backup when the subscription is out of capacity. Product building needs the strongest
    model, so this is the reverse of the factory's free-first routing (owner, 2026-10-10).
  - The factory runs free-model-first, and its paid tier has a $0 budget.
  - Private repos never go to free cloud models.
- **Data classes** ([personal-context.md](personal-context.md)):
  - **public** and **personal** may go to cloud models;
  - **work** (employer-confidential) stays on local models only;
  - **financial** is never ingested.
- **Humans merge:** the factory and the idea builder open draft PRs. Nothing merges, force-pushes or
  deletes on its own.
- **The owner's choice wins:** a Notion status the owner sets overrides any pipeline verdict.

## Communication and visibility

| Channel | What goes there |
|---|---|
| **Slack #team-agents** | Real-time: system alerts (🔴 failing, 🟠 still failing every 6h, 🟢 recovered), and conversations with the companion |
| **WhatsApp** | Personal: companion morning and evening messages, the AI briefing, the daily idea report |
| **Morning email** (06:45) | The daily digest: review queue, ideas and revenue, the factory's roles, what's failing now across every system |
| **RepoHQ Agents page** | The factory's queue, runs and traces, the Activity Log, and the **System log** (failing now plus the latest events) |
| **Notion Idea Board** | Decisions on ideas |

## How an AI agent gets context

1. **Skill `portfolio-context`**: loads this picture into any Claude Code session. It's linked into
   `~/.claude/skills` by `bash skills/install.sh`.
2. **MCP server `repohq`**, registered at user scope:
   - `get_system_overview` gives this doc plus live counts;
   - `search_context` searches repos, ideas, bookmarks and docs (public and personal only);
   - `get_portfolio_summary`, `get_repo_context` and `get_next_action` cover portfolio state.
3. **CLI:** `npm run context -- search "<query>" | interests | overview` in RepoHQ, or
   `~/idea-factory/bin/context` (cloud-safe classes only).
4. **Each repo's `CLAUDE.md`/`AGENTS.md`** points here, and so does `~/.claude/CLAUDE.md`, which every Claude Code session loads.
5. **OpenClaw (Slack, WhatsApp):** the companion and main agents get a generated **system brief** in their `AGENTS.md` (`factory/context/brief.ts`). It covers the goal, the parts, the rules, what's failing now, the ideas in flight, and how to look things up.
   - It's refreshed daily and whenever something starts failing or recovers.
   - OpenClaw adds it to every turn (`contextInjection: always`), so local and cloud models alike answer with the current picture.
   - They can't read the docs here, because macOS keeps launchd jobs out of `~/Documents`.

## Scorecard (2026-10-10)

Rated against the goal. "Was" is the review at the start of 2026-10-10; "now" is after that day's work.

| Layer | Was | Now | What changed / what's still weak |
|---|---|---|---|
| Safety and governance | Strong | Strong | Docker sandbox, judge, human merge, capability ladder, data classes, $0 policy |
| Maintenance factory | Works, narrow | Works, narrow | 78% acceptance at $0, but it fixes lint, deps, docs and tests and has never built a feature. Average PR value is 1.6/5. |
| Verification | Weak | Fair | Every code change is judged on the build, and each PR's Vercel preview is smoke-tested in a browser next to production. Pages behind a login aren't checked yet. |
| Routing | Rules + history | Rules + history + **tier advisor** (report) | A local model rates each task 1–3. It's scored against outcomes and promoted on evidence. |
| Local coding | Weak | Weak | The local tier (M0) verified 1 of 7 attempts last week. Building runs on Claude Pro and the free pool. Needs 64–128 GB of unified memory for 30B-class local coders. |
| Idea generation | Works | Strong | Daily, sourced, portfolio-checked, on Claude Pro; full record in git; lossless Notion pages |
| Idea review | Missing | Works | gstack frameworks applied non-interactively. Four free-developer-tool ideas passed (scores 2–5): the bar is real. Research now has to name who pays and learn from those verdicts, and the next idea, **permitly**, reached Validate (6/10). |
| Demand test | Missing | **Live** | permitly's page went up automatically (https://idea-pages-livid.vercel.app/permitly/, decision on 2026-10-24). Signals, decision rules and the launch post (`LAUNCH.md`) all work. Distribution is still on the owner. |
| Building ideas | Missing | Built, first run pending | M1 tests first on Claude Pro, draft PR. Runs on the host with install scripts off; next step is the Docker sandbox. |
| Context | Fragmented | Works | One index (44 repos, ideas, 258 bookmarks, 183 doc sections), MCP tools, a skill. Keyword search, no embeddings. |
| Revenue loop | Missing | Wired, no data yet | Idea MRR from RepoHQ in each idea's state, the Notion board and the morning email. Total portfolio MRR is $4.99. |
| Operations | Fragile, visible | Fragile, **watched** | One system log across every part. Probes cover services, launchd jobs, OpenClaw crons, GitHub crons and provider errors, with alerts to Slack. Still one Mac. |

**Weakest links now, in order:**
1. **Distribution.** A landing page nobody sees proves nothing; posting the launch post is on the owner (permitly's is ready).
2. **The first real build.** M1 building is proven by a test run (tripsplit, 19 tests); the first real one follows a Build decision.
3. **Local model quality**, which is a hardware problem.
4. **Single-Mac operations.**

## Schedules (local time)

| When | What | Where |
|---|---|---|
| Hourly 20:00–06:00, 12:00, 16:00 | Factory cycle (fixes, reconcile, preview smoke) | BullMQ worker on the Mac |
| 06:45 | Morning email; rebuilds the context index first | worker |
| 09:00 | Idea research (Claude Pro, else scout on free models) | OpenClaw cron `idea-to-repo` |
| Every 5 min | System-events collector: ship the log, probe everything (incl. Vercel deploys), alert Slack, refresh the companion's brief; daily: prune, secrets check | launchd `com.user.system-events` |
| 03:30 | Factory state backup (ledger, reports) → private repo | launchd `com.user.factory-backup` |
| Every 15 min (daily steps after 09:30) | Idea pipeline tick: Notion sync, signals, decisions, promote, revenue; daily review, landing pages, M1 build | launchd `com.user.idea-pipeline` |
| Daily, weekly | RepoHQ sync, security, deployments, AI summaries, digest | GitHub Actions crons |

## What's next

- Run the idea builder inside the factory's Docker sandbox with a Claude subscription token.
- Smoke-test logged-in pages (a test account per app).
- Vercel runtime errors into the system log (the last unwatched surface).
- A stronger demand signal than signups: a "what would you pay" step on landing pages.
- Embeddings for the context index, if keyword search starts missing things.
- Hardware: 64–128 GB unified memory, after the 30-day experiment's numbers are in (2026-11-06).
