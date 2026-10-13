# System overview: the big picture

> Read this first. It's the map of the whole system, for the owner and for any AI agent starting
> cold on one of its repos. Agents get it through the `portfolio-context` skill or the RepoHQ MCP tool
> `get_system_overview`. Updated 2026-10-10.

**Visual map:** [smithdavedesign System Map](https://claude.ai/artifact/SdinhSGDxFhgMbWZsSPPso), covering architecture, the idea flow and each repo's code stack. It's a private snapshot from 2026-10-11. This doc is the source of truth; the map isn't updated with it.

## The goal

**Make things people use and pay for, with near-zero overhead for the owner and no financial risk.**

A local AI stack knows the owner's repos, interests and ideas. It researches product ideas, reviews
them, cheaply tests demand, builds the ones that show signal, keeps every repo healthy, and tracks
what actually earns money. The owner's job shrinks to deciding (Build or Pass an idea, a PR the agents
left for him) and posting; each morning he reviews what the agents merged and reverted on their own.

## The loop

```
             ┌──────────────────── context index (repos · ideas · bookmarks · docs) ────────────────────┐
             ▼                                                                                          │
  research (daily) ─▶ gstack review ─▶ demand test ($0 landing page) ─▶ build M1 (tests first) ─▶ live ─┼─▶ revenue (MRR)
     Claude Pro          validate/pass      14 days, visitors+signups        PR, merged once green        │      tracked in RepoHQ
     → free models                                                                                        │
             ▲                                                                                          │
             └──── RepoHQ health + factory: keep every repo working (lint, types, tests, deps, docs) ◀───┘
```

| Stage | What happens | Who decides | Cost |
|---|---|---|---|
| Research | One idea a day, sourced (no URL, no claim), checked against the owner's portfolio and interests | the pipeline | $0 (Claude Pro subscription, free models as fallback) |
| Review | gstack office-hours Six Forcing Questions, premise challenge, alternatives; CEO scope reduction; eng feasibility of M1 | the pipeline, policy on top; **the owner can override on RepoHQ's Ideas page or in Notion** | $0 |
| Demand test | A public landing page with a waitlist and a launch post the owner may share; 14 days | the numbers (`policy.json`) | $0 (Vercel Hobby) |
| Build | M1's exit criteria become tests first, then the code; a PR in the idea's private repo | the pipeline merges it once its tests and every check pass; **the owner reviews it in the morning email** | $0 |
| Live and earning | RepoHQ tracks lifecycle, health and MRR; the factory keeps it healthy | the owner | free tiers until it earns |

**After launch: the growth loop** ([growth-loop-prd.md](growth-loop-prd.md), step 5d of the idea pipeline, since 2026-10-12).
- **Each tick:** for each focus product (`policy.growth.focus` in idea-factory; tiebreak first), the pipeline reads the funnel and picks the bottleneck by rule: launch → instrument → acquire → activate → monetize → retain, or park.
- **Once a day per product:** it starts one mission. That's a growth build (one change, as a PR, on Sonnet), a launch kit of posts the owner publishes, or an item in the morning email's Today block.
- **Each mission is an experiment** with a baseline, a target and a window. Merging the growth PR starts it; a growth PR whose checks fail is closed, and the mission is tried again the next day.
- **When the window ends,** the judge compares it with the window before: keep, iterate, or revert one that made things clearly worse. Each result is a line in the product's `LEARNINGS.md`; a kept one is proposed for the portfolio's `PLAYBOOK.md`.
- **Where it shows:** the Ideas page's Growth card, the email's Growth section, and MCP.
- **Until a focus product reaches 50 visitors a week,** the weekly build slot only finishes MVPs it has started.

## Where everything lives

| Part | Where | What it is |
|---|---|---|
| **RepoHQ** | `smithdavedesign/Github-HQ` (public), https://repohq.vercel.app | Portfolio dashboard: health, lifecycle, revenue, decision states. Hosts the idea signal endpoint and the MCP server. [Architecture](architecture.md) |
| **Factory** | `factory/` in this repo; runs on the owner's Mac (launchd worker, BullMQ via Render Redis) | Free-model-first maintenance on its allowlist (`factory.config.json`, plus repos the owner opens from RepoHQ with one click): sandboxed fixes judged by checks, build and preview smoke; PRs it merges itself once every check is green, and reverts if they break `main`. "Fix it" on an Advisor security item runs `npm audit fix` (never `--force`) in every lockfile. [Design](autonomous-factory.md), [operator guide](../factory/README.md) |
| **Idea pipeline** | private repo `idea-factory` (`~/idea-factory`), Notion **Idea Board**, public landing pages on the `idea-pages` Vercel project | Research → review → demand test → build → go live → revenue; git holds every idea in full. [Idea factory](idea-factory.md) |
| **Context index** | `factory/context/`, built daily into `~/.repohq-factory/context/index.json` | One searchable view of repos, ideas, bookmarks and docs, tagged by data class |
| **Resource Center** | private repo `resource-center` (`my-bookmarks-hub` on Vercel, behind Vercel auth) + the Bridge Chrome extension | The owner's bookmarks as a knowledge source; feeds interests into the context index |
| **Local AI stack** | `~/ai-stack`, private repo `smithdavedesign/ai-stack` | Ollama, LiteLLM (model aliases and the free pool), Headroom, coding agents. [AI stack docs](ai-stack/README.md) |
| **OpenClaw** | `~/.openclaw` | `companion` (personal memory; reachable on **WhatsApp** and **Slack**), `scout` (idea research fallback, no personal context), `main` |
| **Slack** | workspace channel **#team-agents** (app `repoHQ-message`, socket mode through OpenClaw) | The communication layer: talk to the companion (@-mention in the channel, or DM), and where **system alerts** land: failures, reminders, recoveries |
| **System log** | `~/.system-events/events.jsonl` → collector (launchd, 5 min) → Neon `system_events` | One log across every part, with probes and Slack alerts. [Logging](logging.md) |
| **Backups** | private GitHub repos | `ai-stack` (the stack's config and scripts, never `.env`), `repohq-factory-state` (the factory's ledger and reports, nightly), `idea-factory` (every idea's record). Code repos live on GitHub. |
| **Secrets** | macOS keychain + `~/ai-stack/bin/secrets` | One source of truth; `check` runs daily; `rotate litellm` updates every copy. [Authentication](ai-stack/authentication.md) |
| **Notion** | Idea Board, task boards | The board the idea pipeline follows; the owner decides on RepoHQ's Ideas page, which sets it |

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
  - RepoHQ's own AI features (repo summaries, the Advisor, plain-English search) use OpenRouter's free models or Gemini's free tier. Claude and GPT-4o need `LLM_ALLOW_PAID=1` (until 2026-10-12 they ran on an Anthropic API key).
  - Private repos never go to free cloud models.
- **Data classes** ([personal-context.md](personal-context.md)):
  - **public** and **personal** may go to cloud models;
  - **work** (employer-confidential) stays on local models only;
  - **financial** is never ingested.
- **Show it working:** a built or deployed MVP proves itself with screenshots from real browser automation (Playwright, desktop and phone), at the top of its README. The idea builder does it in every build and go-live PR ([idea-factory.md](idea-factory.md)); a person or agent shipping an MVP by hand does the same against the live URL.
- **Everything merges itself, and what breaks is reverted** (the owner's call: agents 2026-10-12, interactive sessions too 2026-10-13, "full send"):
  - the factory and the idea pipeline merge a PR once its tests and every check are green and nothing objected (the preview smoke test, the adversarial reviewer, a `hold` label, a review asking for changes);
  - a merge that turns the base branch red, or breaks a live site's launch checks, is undone by a revert PR the agent merges, and Slack is told;
  - an autonomous agent never merges a PR touching its own rules (factory code, CI workflows, the model router);
  - an interactive Claude session opens a PR so CI runs, merges it itself once CI is green, and deploys; the owner reviews afterwards, not before;
  - nothing force-pushes or deletes.
  Code: `factory/lib/automerge.ts` (config `autonomy`), idea-factory `lib/autonomy.js` (`policy.autonomy`).
- **Agents never see secrets:** databases and API keys come from the credential broker `~/ai-stack/bin/provision`, which writes values straight to the keychain, Vercel env or GitHub secrets. It works on idea repos only and in agent accounts with no card. Anything it can't do is a Slack request to the owner ([provisioning](provisioning.md)).
  - It also makes Stripe payment links, with restricted keys that can create products, prices, links and webhooks and nothing else.
  - Live mode uses a key only the owner can create, and runs at his word. tiebreak has sold Pro at $5 once since 2026-10-13.
- **The owner's choice wins:** a decision on RepoHQ's Ideas page, or a Notion status the owner sets, overrides any pipeline verdict.

## Communication and visibility

| Channel | What goes there |
|---|---|
| **Slack #team-agents** | Real-time: system alerts (🔴 failing, 🟠 still failing every 6h, 🟢 recovered), and conversations with the companion |
| **WhatsApp** | Personal: companion morning and evening messages, the AI briefing, the daily idea report |
| **Morning email** (06:45) | The daily digest. It opens with **Done overnight**: what the agents merged, reverted and judged on their own. Then **Today**: at most five things for the owner, money first: a focus product's checklist step, the next post from a launch kit, idea PRs the pipeline left for him ([growth loop](growth-loop-prd.md)). Then the review queue, ideas and revenue, the focus products' funnels (**Growth**), the factory's roles, and what's failing now across every system |
| **RepoHQ Agents page** | **Needs attention** on top, then tabs (`?tab=`): **Now** (the idea pipeline: building now, queued, caps, latest runs; Subscriptions: Claude Pro and Copilot use), **Runs** (the factory's worker, queue, schedules, runs and traces; data syncs), **Requests** (every request with its trace; 90-day figures), **KPIs** (factory KPIs, advisor accuracy, tiers, cost), **Log** (the **System log**: failing now plus the latest events; the Activity Log) |
| **RepoHQ Ideas page** | Review ideas and decide: approve a build, demand-test or pass (applied through the Notion Idea Board within 15 min). Sort by score, credibility (the review's demand score), effort or newest; filter by tags (vibe, who it's for, money, where the first users come from, AI, topics), score, effort and text |
| **Notion Idea Board** | The board the idea pipeline follows; decisions can still be made here |

## How an AI agent gets context

1. **Skill `portfolio-context`**: loads this picture into any Claude Code session. It's linked into
   `~/.claude/skills` by `bash skills/install.sh`.
2. **MCP server `repohq`**, registered at user scope:
   - `get_system_overview` gives this doc plus live counts;
   - `search_context` searches repos, ideas (with the growth playbook, idea-factory `PLAYBOOK.md`), bookmarks and docs (public and personal only);
   - `get_system_status` gives what's failing now and counts per system (the same as `~/ai-stack/bin/system-status`);
   - `get_idea_pipeline` gives each idea's stage and demand test against the decision rules, a built product's funnel (visits, activations, Buy clicks, this week against the last), and with a slug, visitors by source and the launch posts logged;
   - `get_portfolio_summary`, `get_repo_context` and `get_next_action` cover portfolio state.
3. **CLI:** `npm run context -- search "<query>" | interests | overview` in RepoHQ, or
   `~/idea-factory/bin/context` (cloud-safe classes only).
4. **Each repo's `CLAUDE.md`/`AGENTS.md`** points here, and so does `~/.claude/CLAUDE.md`, which every Claude Code session loads.
5. **OpenClaw (Slack, WhatsApp):** the companion and main agents get a generated **system brief** in their `AGENTS.md` (`factory/context/brief.ts`). It covers the goal, the parts, the rules, what's failing now, the ideas in flight, and how to look things up.
   - It's refreshed daily and whenever something starts failing or recovers.
   - OpenClaw adds it to every turn (`contextInjection: always`), so local and cloud models alike answer with the current picture.
   - They can't read the docs here, because macOS keeps launchd jobs out of `~/Documents`.
   - They also get the `repohq` MCP server read-only (`MCP_READONLY=1`: no queueing or logging from a chat) and the `launch` and `ai-stack` skills ([personal-assistant.md](ai-stack/personal-assistant.md)).

## Scorecard (2026-10-10)

Rated against the goal. "Was" is the review at the start of 2026-10-10; "now" is after that day's work.

| Layer | Was | Now | What changed / what's still weak |
|---|---|---|---|
| Safety and governance | Strong | Strong | Docker sandbox, judge, capability ladder, data classes, $0 policy. Since 2026-10-12 agents merge their own green PRs: the human merge is traded for gates (every check, the preview smoke test, the adversarial reviewer, protected paths) and automatic reverts, with the owner reviewing each morning. |
| Maintenance factory | Works, narrow | Works, narrow | 78% acceptance at $0, but it fixes lint, deps, docs and tests and has never built a feature. Average PR value is 1.6/5. |
| Verification | Weak | Fair | Every code change is judged on the build, and each PR's Vercel preview is smoke-tested in a browser next to production. Pages behind a login aren't checked yet. |
| Routing | Rules + history | Rules + history + **tier advisor** (report) | A local model rates each task 1–3. It's scored against outcomes and promoted on evidence. |
| Local coding | Weak | Weak | The local tier (M0) verified 1 of 7 attempts last week. Building runs on Claude Pro and the free pool. Needs 64–128 GB of unified memory for 30B-class local coders. |
| Idea generation | Works | Strong | Daily, sourced, portfolio-checked, on Claude Pro; full record in git; lossless Notion pages |
| Idea review | Missing | Works | gstack frameworks applied non-interactively. Four free-developer-tool ideas passed (scores 2–5): the bar is real. Research now has to name who pays and learn from those verdicts, and the next idea, **permitly**, reached Validate (6/10). |
| Demand test | Missing | **Live** | permitly's page went up automatically (https://idea-pages-livid.vercel.app/permitly/, decision on 2026-10-24). Signals, decision rules and the launch post (`LAUNCH.md`) all work. Distribution is still on the owner. |
| Building ideas | Missing | Built, first runs under way | Milestones tests first on Claude Opus at extra-high effort (Sonnet, then the free pool, as fallbacks), planned and self-reviewed with gstack, draft PR. Approving builds the whole MVP in one run (stopping at failing tests); one a week automatically, plus up to 2 a day started from the Ideas page. Runs in the factory's Docker sandbox (subscription token; network only to registries and Anthropic), and every patch passes a secret scan before it's committed. Every build PR shows screenshots of the product working (Playwright in the sandbox), also at the top of the README. |
| Context | Fragmented | Works | One index (44 repos, ideas, 258 bookmarks, 183 doc sections), MCP tools, a skill. Keyword search, no embeddings. |
| Revenue loop | Missing | Wired, tracked per idea | Idea MRR from RepoHQ in each idea's state, the Notion board and the morning email. Each idea now has a road to revenue: a plan once M1 merges, and a checklist to the first dollar checked every tick, with the owner's steps in the morning email. A completed MVP gets a go-live build (SEO basics, legal pages, a Buy button, the visit beacon, a Vercel project), and the live site is audited every 6 hours. Build queues go to the idea closest to money. Total portfolio MRR is $4.99. Since 2026-10-13 tiebreak takes real payments ($5 once, through the broker's live Stripe key) and codespend is live (https://codespend.vercel.app). One-time payments don't count toward MRR yet. |
| Operations | Fragile, visible | Fragile, **watched** | One system log across every part. Probes cover services, launchd jobs, OpenClaw crons, GitHub crons and provider errors, with alerts to Slack. Still one Mac. |

**Weakest links now, in order:**
1. **Distribution.** A landing page nobody sees proves nothing. tiebreak can take payments but had 6 visitors in its first week; codespend went live on 2026-10-13. Posting stays the owner's job; the growth loop ([growth-loop-prd.md](growth-loop-prd.md)) makes it one item a day, with posts drafted and measured.
2. **The first real build.** M1 building is proven by a test run (tripsplit, 19 tests); the first real one follows a Build decision.
3. **Local model quality**, which is a hardware problem.
4. **Single-Mac operations.**

## Schedules (local time)

| When | What | Where |
|---|---|---|
| Hourly 20:00–06:00, 12:00, 16:00 | Factory cycle (fixes, reconcile, preview smoke) | BullMQ worker on the Mac |
| 06:45 | Morning email; rebuilds the context index first | worker |
| 09:00 | Idea research (Claude Pro, else scout on free models) | OpenClaw cron `idea-to-repo` |
| Within 15 min of sending | Research + review of an idea the owner sent, verdict back on Slack or WhatsApp (≤ 10 a day, one per tick, so a batch clears the same night) | idea pipeline tick |
| Every 5 min | System-events collector: ship the log, probe everything (incl. Vercel deploys), alert Slack, refresh the companion's brief; daily: prune, secrets check | launchd `com.user.system-events` |
| 03:30 | Factory state backup (ledger, reports) → private repo | launchd `com.user.factory-backup` |
| Every 15 min (daily steps after 09:30) | Idea pipeline tick: Ideas-page decisions, Notion sync, signals and funnels, decisions, promote, an approved idea's M1 build, revenue, a go-live once an MVP is complete (≤ 1 a day), the live audit (every 6 h per live idea), the growth step (focus products; from 10:00, ≤ 2 missions a day), sync to RepoHQ; daily review, landing pages, M1 build | launchd `com.user.idea-pipeline` |
| Every 6 h, daily, weekly | RepoHQ sync (with security alerts, so counts follow merges within hours), the full security scan, deployments, AI summaries, digest | GitHub Actions crons |

## What's next

- CI on pull requests for the factory repos that have none (7 of 9). Their PRs merge on the factory's own sandboxed checks, the Vercel preview build where there is one, and the smoke test.
- Smoke-test logged-in pages (a test account per app).
- Vercel runtime errors into the system log (the last unwatched surface).
- A stronger demand signal than signups: a "what would you pay" step on landing pages.
- Embeddings for the context index, if keyword search starts missing things.
- Hardware: 64–128 GB unified memory, after the 30-day experiment's numbers are in (2026-11-06).
