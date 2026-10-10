# Idea factory

The idea half of the system ([system overview](system-overview.md)). Every day it researches one product idea, reviews it with the gstack frameworks, runs a $0 demand test on the ones worth testing, builds M1 for the ones that show signal, and tracks their revenue. The owner decides only what matters: Build or Pass on the Notion **Idea Board**, and merging the M1 PR.

It lives outside this repo, in the private **`idea-factory`** repo: the pipeline code, its tests, and the **record** of every idea in full (`ideas/<slug>/`). The daily job runs in OpenClaw. This page documents the contract between those parts and RepoHQ.

## Flow

```
idea ──gstack review──▶ validate ──14-day demand test──▶ build ──▶ repo ──M1 PR (tests first)──▶ building ──▶ live (MRR)
  └──────────────────▶ pass ◀──── no signal / review says no / owner says no
```

Each idea's lifecycle record is `ideas/<slug>/state.json` (stage, review, page, signals, validation, repo, build, revenue). RepoHQ reads it for the morning report (`factory/context/ideas.ts`).

### 1. Research (daily 09:00)

```
09:00 daily (OpenClaw cron, agent "scout")
  │  1. idea-research.js: Claude Code headless on the owner's Claude Pro subscription (never API credit)
  │  2. if that fails (usage limit, logged out, timeout): scout researches itself on the free model pool
  │  seeds first: ideas the owner sent on WhatsApp ("idea: …"), else discovery on the web
  │  4–8 web searches → RESEARCH.md, PRD.md, ROADMAP.md, idea.json (draft folder)
  ▼
idea-publish.js publish ── validates the draft
  ├─▶ ideas/<slug>/ committed and pushed to idea-factory (the record: complete, versioned)
  └─▶ Notion row, Status "Idea": full research + PRD + roadmap + sources in the page, a Docs link
      to the record, the repo name reserved
      WhatsApp: title, one-liner, closest existing repo, Notion link, which engine did the research
```

### 2. Review (daily, after 09:30)

`bin/idea-review.js` runs the `idea-review` skill (`idea-factory/skills/idea-review/SKILL.md`) on the Claude Pro subscription.
- **Inputs:** the script gathers them so the review never depends on the model running commands.
  - The owner's interests and related repos/ideas come from the context index.
  - The gstack framework sections are taken from the installed copy, so gstack upgrades flow through:
    - office-hours: Phase 2A (the Six Forcing Questions, anti-sycophancy), Phase 3 premise challenge, Phase 4 alternatives;
    - plan-ceo-review: Step 0 in scope-reduction mode;
    - plan-eng-review: Step 0, as the feasibility check on M1.
- **Outputs:** `REVIEW.md` and `review.json`, with a verdict (`validate` or `pass`), a 0–10 score, each forcing question's evidence and score, the wedge, kill criteria, and the landing-page copy and launch post.
- **Policy on top** (`policy.json`): a score below 6, or an MVP that needs money, is a pass whatever the reviewer said.

On 2026-10-10 the first four ideas all passed (scores 2–5). They were free developer tools with no payer, or in crowded markets. Research now has to name **who pays, how much, and evidence they pay for something like it today**, and must read earlier `review.json` verdicts. The next idea, **permitly** (a permit and rule-change tracker for short-term-rental operators), reached Validate (6/10), and its demand test went live the same day. The bar is meant to be high.

### 3. Demand test (14 days, $0)

- **Landing page:** each `validate` idea gets one, rendered deterministically from the review (escaped, honest: "not built yet") at `https://idea-pages-livid.vercel.app/<slug>/` (Vercel Hobby, public).
- **Signals:** the page posts a view on load and a signup on submit to RepoHQ's public `POST /api/ideas/signal`. Inputs are validated, a honeypot catches bots, IPs are stored only as an HMAC, and each visitor has hourly limits. Rows go to the `idea_signals` table.
- **Launch post:** `LAUNCH.md` in the idea's record has a ready-to-paste post and where to share it. **Distribution is the owner's only job here, and the weakest link**: a page nobody visits proves nothing.
- **Decision rules** (`decideValidation`, every tick):
  - **build** early at ≥ 10 signups and ≥ 8% conversion, or at the deadline at ≥ 5 signups and ≥ 5%;
  - **pass** below that;
  - **extend** once if fewer than 50 visitors came, because untested isn't "no demand", then park.
- Signups are a cheap filter, not proof: gstack's "interest is not demand" applies. Real demand is judged after M1, on usage and revenue.

### 4. Build

- **Repo:** a `build` decision, or the owner setting Notion **Build**, makes `promote` create the private repo (topic `idea`) from the record.
- **M1:** `bin/idea-build.js` builds it on the Claude Pro subscription, at most one a week:
  - ROADMAP M1's exit criteria become failing tests first;
  - then the smallest $0 stack, implemented until the tests pass, plus `BUILD.md`;
  - the pipeline runs the tests itself and opens a **draft PR** (branch `m1`) that the owner merges.
- **Safety:** it runs on the host with npm install scripts disabled. Claude may only edit inside the clone and run npm, npx, node and read-only git. Next step: the factory's Docker sandbox with a subscription token.

### 5. Revenue

- **Tracking:** RepoHQ already tracks lifecycle and MRR per repo. Each tick, the pipeline:
  - marks a new idea repo `building` (purpose Revenue) in RepoHQ;
  - copies its MRR into `state.json` and the Notion `MRR` column;
  - moves the idea to `live` when the owner sets the repo's lifecycle to beta, production or growing.
- **Reporting:** the morning email's "Ideas, demand and revenue" section shows the whole pipeline.

The first version created a private repo every night. That would have added about 30 repos a month to a portfolio where RepoHQ already rates 35 of 47 active repos as archive candidates. Now a repo exists only after the owner says yes.

## Status lifecycle (Notion `Status`)

| Status | Set by | Meaning |
|---|---|---|
| `Idea` | pipeline | Researched and recorded; review pending. The page has the full research, PRD, roadmap and sources. |
| `Validate` | pipeline (review) | Worth a demand test: landing page live, signals counting. The page has the review. |
| `Build` | pipeline (demand) or **owner** | Create the repo. `promote` picks it up within 15 minutes. The owner can set it at any stage to override a pass. |
| `Repo Created` | pipeline | The private repo exists (`GitHub_URL`, topic `idea`); M1 build next, then its PR |
| `Live` | owner (or RepoHQ lifecycle) | Shipped; MRR tracked |
| `Pass` | pipeline or **owner** | Not now. Research never proposes it again. |

**The owner's status wins:** each tick reads Notion first, and Pass, Build or Live set by the owner override any pipeline verdict.

Pipeline columns: `Verdict`, `Score` (review), `Page` (landing page), `Visitors`, `Signups` (demand test), `MRR` (revenue), and `Docs` (the git record).

Older options (`Pending`, `In Progress`, `Done`) belong to the earlier pipeline. Its listicle rows were set to `Pass` on 2026-10-10.

## Notion row

| Property | Content |
|---|---|
| `Name` | Product title |
| `Slug` | Repo name: kebab-case, 1–2 words, brandable. Reserved at publish time (refused if taken on GitHub). |
| `Description` | One sentence: who it's for and the pain it removes |
| `Keywords`, `EffortEstimate`, `Confidence` | The agent's judgment from the research (Low / Medium / High). Never invented revenue numbers. |
| `Sources` | URLs behind every claim (at least 3). No URL, no claim. |
| `GitHub_URL` | Set when the repo is created |
| `AddedAt`, `SpecCreatedAt` | Timestamps |

## Draft and repo layout

```
RESEARCH.md   summary · evidence of the problem · competitors (name, price, gap) · technical notes · risks · sources
PRD.md        Problem · Target user · Competitors & gap · MVP scope · Non-goals · Success metrics · Open questions
ROADMAP.md    M1 (a weekend, usable) … each milestone with deliverables and an exit criterion written as testable checks
idea.json     title, repoName, oneLiner, overlaps, tags, effort, confidence, sources, seedId
README.md     added when the repo is created
```

`idea.json.overlaps` is required. It names the closest existing repo in the owner's portfolio, or says "none". The research step reads the portfolio (every repo's name and description) and must not propose a product the owner already has. The first nightly idea, an offline trip expense splitter, duplicated Open-Travel's budget page, which is how this rule came about.

## Nothing is lost between research and Notion

The agent's files are the source. Both destinations keep all of their text:

- **Git (`idea-factory/ideas/<slug>/`)** stores the files byte for byte, with history. This is the record that agents and the factory read.
- **The Notion page** carries the same text, converted to Notion blocks within Notion's API limits:
  - long text is split into 2,000-character pieces, and pieces into further blocks past 100 per block;
  - tables over 100 rows get the rest appended after;
  - h4 and deeper headings become bold paragraphs, and nested lists become indentation;
  - appends are batched by count and size.

  Formatting may be simplified, but text never is. `Sources` and `Description` are Notion *properties* capped at 2,000 characters, so the full source list is in the page body and in git.
- **Tests** (`npm test` in idea-factory: the conversion tests below plus the pipeline's decision rules, landing-page escaping, review validation, orchestrator rules and Claude runner guards):
  - converting markdown to blocks is lossless (every non-whitespace character, in order) up to a 1.2 MB worst-case bundle;
  - every request fits Notion's limits;
  - emoji are never split;
  - the research runner refuses API-key auth and MCP connectors.

  `npm run test:live` sends a 51,000-character stress page (a 131-row table, a 9,000-character code block) through the real Notion API, reads it back, and compares.
- **Checking a real page:** `idea-publish.js verify-page <slug>` reads a page back and fails if any text is missing. `sync-page <slug>` rebuilds a page from git after the docs are edited.

## Agents and data

- **Claude Code on the Pro subscription** does the research first (`idea-research.js`).
  - The Anthropic API variables are removed from its environment, and a run that reports any API-key auth source is refused.
  - It runs with no user settings, plugins, hooks, MCP servers or claude.ai connectors, and no skills.
  - It may search and fetch the web, write only to `drafts/`, and run only the publish script.
- **`scout`** (OpenClaw agent) runs the job and is the fallback researcher on the free pool. It has no personal context: no `USER.md`, no memory, and its workspace says not to read the owner's other workspaces. Its cron job may use only `exec`, `read`, `write`, `ollama_web_search` and `ollama_web_fetch`. It reads untrusted web pages all day, so it is kept apart from the owner's life context (see [personal-context.md](personal-context.md)).
- **`companion`** (OpenClaw, WhatsApp) never researches. An `idea: …` message is only queued as a seed (`idea-publish.js seed`), and scout researches it on its next run.
- **The script does every side effect** (Notion, `gh`, `git`), always with argument arrays and never shell strings, because titles come from the web.
- **Models:** Claude (Pro subscription) first, then the free pool (`free-agent`). Ideas are public research, so free cloud models are acceptable as the fallback. That is not true for private repos (below).

## How the factory fits in

On 2026-10-10 the owner chose to build the idea loop now rather than after the 30-day window. The factory's role is maintenance, and it stays that way:
- **M1 is built by `idea-build.js`** on the Claude Pro subscription, with tests first, so the PR has its own oracle.
- **After M1 merges, the idea repo is an ordinary repo.** It can join the factory's allowlist like any other, and its tests become the judge's checks.
- **Model constraint:** private repos never go to free cloud models, so in the factory they get the local tier until better local hardware arrives. Claude Pro (in idea-build) is how they get real building quality today.

## Operations

| What | Where |
|---|---|
| Schedule | OpenClaw cron `idea-to-repo`, daily 09:00 PT, agent `scout`, report to the owner's WhatsApp |
| Skill | `skills/idea-to-repo/SKILL.md` in the scout workspace |
| Record + code | private repo `idea-factory`: `ideas/<slug>/`, `bin/`, `lib/`, `test/`, `SKILL.md` (the one copy of the research steps) |
| Script | `bin/idea-publish.js`: `list`, `seed`, `seeds`, `publish`, `promote [--dry-run]`, `sync-page`, `verify-page` |
| Research runner | `bin/idea-research.js` (Claude Pro); `--check` proves the subscription login without recording anything |
| Pipeline | launchd `com.user.idea-pipeline`, every 15 minutes: `bin/idea-pipeline.js tick` (daily steps after 09:30; `--daily` forces them). Log `pipeline.log` |
| Review / build by hand | `bin/idea-review.js <slug>`, `bin/idea-build.js <slug> [--no-push]`; skill `/idea-review` |
| Policy | `policy.json`: $0 spend, review bar, validation window and thresholds, one build a week |
| Landing pages | `pages/<slug>/index.html` in idea-factory, deployed to the Vercel project `idea-pages` (public) |
| Run research now | `openclaw cron run <job-id>` (records a real idea and sends the WhatsApp report) |
| Check what would be promoted | `node idea-publish.js promote --dry-run` |
| Demand signals | RepoHQ `POST /api/ideas/signal` → table `idea_signals` (migration `factory/sql/0004`) |
