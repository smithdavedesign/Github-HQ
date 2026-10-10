# Idea factory

A daily job on the local AI stack researches one product idea and records it on a Notion **Idea Board**. The owner decides which ideas become repos. The plan is for the RepoHQ factory to build approved ideas later, but not yet (see [Factory pickup](#factory-pickup-after-the-30-day-window)).

It lives outside this repo: the job runs in OpenClaw, and its one script lives in the owner's home directory. This page documents the contract between those parts and RepoHQ.

## Flow

```
09:00 daily (OpenClaw cron, agent "scout")
  │  seeds first: ideas the owner sent on WhatsApp ("idea: …"), else discovery on the web
  │  4–8 web searches → RESEARCH.md, PRD.md, ROADMAP.md, idea.json (draft folder)
  ▼
idea-publish.js publish ── validates the draft ──▶ Notion row, Status "Idea"
  │                                                  (PRD + roadmap in the page, repo name reserved)
  │                                                  WhatsApp: title, one-liner, closest existing repo, Notion link
  ▼
Owner sets Status in Notion:  "Build"  or  "Pass"
  ▼
idea-publish.js promote (launchd, every 15 min)
  └─ "Build" rows with no repo → private repo (topic "idea") from the recorded draft → Status "Repo Created"
```

The first version created a private repo every night. That would have added about 30 repos a month to a portfolio where RepoHQ already rates 35 of 47 active repos as archive candidates. Now a repo exists only after the owner says yes.

## Status lifecycle (Notion `Status`)

| Status | Set by | Meaning |
|---|---|---|
| `Idea` | pipeline | Researched and recorded. The page has the PRD, the roadmap and its sources. Waiting for the owner. |
| `Build` | owner | Create the repo. `promote` picks it up within 15 minutes. |
| `Repo Created` | pipeline | The private repo exists (`GitHub_URL`). It carries the GitHub topic `idea`. |
| `Pass` | owner | Rejected. Research never proposes it again. |

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

## Agents and data

- **`scout`** (OpenClaw agent) does the research. It has no personal context: no `USER.md`, no memory, and its workspace says not to read the owner's other workspaces. Its cron job may use only `exec`, `read`, `write`, `ollama_web_search` and `ollama_web_fetch`. It reads untrusted web pages all day, so it is kept apart from the owner's life context (see [personal-context.md](personal-context.md)).
- **`companion`** (OpenClaw, WhatsApp) never researches. An `idea: …` message is only queued as a seed (`idea-publish.js seed`), and scout researches it on its next run.
- **The script does every side effect** (Notion, `gh`, `git`), always with argument arrays and never shell strings, because titles come from the web.
- **Models:** the free pool (`free-agent`). Ideas are public research, so free cloud models are acceptable here. That is not true for private repos (below).

## Factory pickup (after the 30-day window)

The [30-day experiment window](roadmap.md) (until 2026-11-06) freezes new executors and capabilities. So the factory does **not** build idea repos yet. When the window closes, the plan is:

1. **A new capability, `idea-scaffold`, starting at stage `report`** (like `red-ci`). Its first task on an idea repo turns ROADMAP M1's exit criteria into failing tests plus a minimal scaffold. That gives the judge an oracle. The factory only ships changes it can verify, and an empty repo has nothing to verify against.
2. **Then the normal loop:** failing tests become `fix-tests` tasks, judged and opened as draft PRs the owner merges.
3. **Model constraint:** idea repos are private, and private repos never go to free cloud models. They get the local tier (weak at greenfield work) or the paid tier, which has a $0 budget today. Building ideas at real quality therefore needs a paid budget decision, or a decision to make some idea repos public.
4. **Portfolio:** idea repos carry the GitHub topic `idea`, so RepoHQ can treat them separately and keep them from dragging down portfolio health while they're young. RepoHQ doesn't sync topics yet; that's part of this work.

## Operations

| What | Where |
|---|---|
| Schedule | OpenClaw cron `idea-to-repo`, daily 09:00 PT, agent `scout`, report to the owner's WhatsApp |
| Skill | `skills/idea-to-repo/SKILL.md` in the scout workspace |
| Script | `idea-publish.js` in the idea-factory home: `list`, `seed`, `seeds`, `publish`, `promote [--dry-run]` |
| Promote job | launchd `com.user.idea-promote`, every 15 minutes, log `promote.log` in the idea-factory home |
| Run research now | `openclaw cron run <job-id>` (records a real idea and sends the WhatsApp report) |
| Check what would be promoted | `node idea-publish.js promote --dry-run` |
