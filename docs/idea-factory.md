# Idea factory

The idea half of the system ([system overview](system-overview.md)). Every day it researches one product idea, reviews it with the gstack frameworks, runs a $0 demand test on the ones worth testing, builds M1 for the ones that show signal, and tracks their revenue. The owner decides only what matters: Build, Demand test or Pass on RepoHQ's **Ideas page** (or the Notion **Idea Board**), and merging the M1 PR.

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

**Ideas the owner sends are researched right away**, not at 09:00. That covers `idea: …` on Slack or WhatsApp and the Ideas page's New idea box.
- **How it runs:** the next pipeline tick (within 15 minutes) runs `idea-research.js` for the oldest queued seed. It then reviews the idea and, for a validate, puts up its landing page. The verdict goes back to where it was sent through `openclaw message send`: WhatsApp seeds reply on WhatsApp, and Slack and page seeds in #team-agents. Code: idea-factory `lib/seeds.js`.
- **Rules** (`policy.research.seeded`):
  - at most 3 runs a day, because Claude Pro is shared with the owner's sessions and M1 builds;
  - 60 minutes after a failed run;
  - none from 08:30 to 09:45, around the daily run;
  - no free-model fallback: a failed run leaves the seed queued.
- **No overlap:** a lock in `idea-research.js` keeps a seeded run and the daily run from running at once.

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
- **Signals:** the page posts a view on load and a signup on submit to RepoHQ's public `POST /api/ideas/signal`. Live products post `visit`, `activate` and `checkout` to the same endpoint (Go live, below). Inputs are validated, a honeypot catches bots, IPs are stored only as an HMAC, and each visitor has hourly limits per kind. Rows go to the `idea_signals` table.
- **Counted every tick** (`lib/repohq.js` `funnelBySlug`, one query):
  - **A demand test** gets `state.signals`: views, unique visitors and signups.
  - **A built product that is deployed or has had a visitor** gets `state.funnel` (`lib/growth.js`):
    - unique visitors, activations and Buy clicks for the last 7 days, the 7 before and all time;
    - the week's top sources, without the product's own pages;
    - which events its beacon has ever sent.

    For products launched before 2026-10-12, home-page views count as visits. The funnel feeds the Ideas page, the morning email's Growth section, MCP, the launch skill, and the checklist's **First user** step (an activation counts).
- **Launch post:** `LAUNCH.md` in the idea's record has a ready-to-paste post and where to share it. **Distribution is the owner's only job here, and the weakest link**: a page nobody visits proves nothing.
  - The `launch` skill (idea-factory `skills/launch/`) makes it a short task. `/launch <slug>` checks that each channel exists and allows the post, adds better ones from the research, and writes a post per channel to `LAUNCH-KIT.md`. The owner posts by hand, then `/launch <slug> posted` appends to `launch-log.json`.
  - `/launch <slug> status` and the MCP tool `get_idea_pipeline` show visitors by referring site next to the posts logged.
- **Decision rules** (`decideValidation`, every tick):
  - **build** early at ≥ 10 signups and ≥ 8% conversion, or at the deadline at ≥ 5 signups and ≥ 5%;
  - **pass** below that;
  - **extend** once if fewer than 50 visitors came, because untested isn't "no demand", then park.
- Signups are a cheap filter, not proof: gstack's "interest is not demand" applies. Real demand is judged after M1, on usage and revenue.

### 4. Build

- **Repo:** a `build` decision, or the owner setting Notion **Build**, makes `promote` create the private repo (topic `idea`) from the record.
- **Engine:** Claude Code on the owner's Claude subscription first, because coding a product from a PRD needs the strongest model. LiteLLM's free pool (`free-agent`, through the same Claude Code harness) is used only when the subscription is out of capacity (usage or rate limit, logged out). Every PR states which engine wrote it.
  - **Model and effort** (`policy.build`): `--model opus --effort xhigh`, which is `claude-opus-5-5` on the subscription.
  - If Opus is overloaded or unavailable on the plan, Claude Code itself drops to `claudeFallbackModel` (`sonnet`), still on the subscription. Effort and model never go to the free pool.
  - There's no local-model step: a 16 GB Mac can't run a coder strong enough for a milestone.
  - Idea repos hold generated code from public research, so the free backup is allowed for them; the "never free cloud" rule protects the owner's own private code.
- **Tier advisor:** before each build, RepoHQ's tier advisor rates the milestone 1–3 on a local model, and the rating is recorded in `state.build.advice`.
  - With `policy.build.advisor` at `"report"` (the default) Claude stays first.
  - At `"act"`, a milestone rated 1 starts on the free pool and moves up to Claude on any failure, saving subscription quota for the hard ones.
- **Milestones:** once a milestone's PR has merged, the pipeline builds the next `## Mn` in ROADMAP.md.
- **Autonomy** (`lib/autonomy.js`, `policy.autonomy`; the owner's call on 2026-10-12: agents merge everything, he reviews each morning). Each tick (step 4a0), every open pipeline PR is looked at:
  - **Merged** (`gh pr ready`, then a squash merge) once the pipeline's own run of the tests passed, every GitHub check is green (CI, GitGuardian, the Vercel preview) and it doesn't conflict. `state.build` records `mergedBy: 'agent'` and `mergedAt`, and the live site is audited again on the next tick.
  - **Closed** when it's a growth PR whose checks failed: its experiment is abandoned as `failed`, and the mission is tried again the next day.
  - **Left for the owner** when it's a milestone or go-live build whose tests or checks failed, or it touches a protected path (`.github/workflows/`). `state.build.held` says why; the morning email's Today block lists it.
  - **Reverted** when the live site's launch checks fail within a day of an agent merge (step 5b): a revert PR, merged, `state.build.reverted`, and a `fail` event so Slack hears of it. The alert closes (Slack: recovered) once the site passes its launch checks again. An experiment the judge finds clearly worse is reverted the same way, as news for the morning email rather than an alert.
  - Interactive Claude sessions merge their own PRs too, once CI is green (the owner's call, 2026-10-13: "full send"); he reviews afterwards.
- **M1:** `bin/idea-build.js` builds it, at most one build a week from the weekly slot:
  - **Plan:** gstack's plan-eng-review (Step 0 scope challenge, architecture review, test review) is applied to the milestone first, and the result goes into `BUILD.md` as `## Plan`;
  - ROADMAP M1's exit criteria become failing tests first;
  - then the smallest $0 stack, implemented until the tests pass, plus `BUILD.md`;
  - **Self-review:** the builder checks its own diff against gstack's pre-landing checklist, fixes the CRITICAL findings and lists the rest in `BUILD.md` as `## Review`. The gstack text is read from the installed copy (`buildInput`) into a file outside the clone, so it's never committed;
  - **Screenshot proof** (the owner's rule, 2026-10-11): the last milestone of a run adds `npm run screenshots`, which starts the app, drives it with Playwright on the sandbox's Chromium (`$CHROMIUM_PATH`) and captures the main flow at desktop size and on a phone. The builder looks at each PNG, then puts them under `docs/screenshots/` and at the top of README.md, under the title;
    - the pipeline checks the README itself (local images above its first other section, at least two, present in the repo). If they're missing it gives the builder one reminder round. The PR then shows the screenshots, pinned to the commit, or says they're missing; it doesn't lose the build over it;
  - the pipeline runs the tests itself and opens a PR (branch `m1`), which it merges once its tests and checks pass (autonomy, above).
- **Start build now:** an approved idea doesn't have to wait for the weekly slot. See [Deciding: the Ideas page](#deciding-the-ideas-page).
- **New-build hold** (`policy.build.startNew: false`, the owner's call on 2026-10-12: distribution before more MVPs).
  - **What waits:** an idea that has never been built waits for its first build, from both the weekly slot and an approval (`newBuildsHeld` in `lib/pipeline.js`).
  - **What carries on:** ideas already being built (codespend and dawnlog's next milestones), and their go-lives. **Start build now** still works.
  - **When it lifts:** by itself, once a focus product (`policy.growth.focus`) has `policy.growth.minVisitorsPerWeek` (50) unique visitors in 7 days ([growth loop](growth-loop-prd.md)).
  - **On the Ideas page:** the Build card and the approval dialog say so.
  - **Weekly cap:** go-live builds, and later growth builds, don't count toward `maxPerWeek`; each has its own cap.
- **Let it rip: MVP builds** (`policy.build.mode: "mvp"`, the default since 2026-10-11).
  - **What runs:** approving a build, and the weekly slot, build *every remaining roadmap milestone in one run* (`buildOne({ mvp })`). It's one sandbox session (the worker lives up to 8 hours), a gstack plan and tests first for each milestone, then one secret scan, one commit and one PR.
  - **When it stops:** at the first milestone whose tests fail, at one that falls back off Opus (`policy.build.mvp.stopOnFallback`, so the rest gets the strongest model), or after `maxMinutes` (240).
  - **The PR** lists every milestone with its result. A merge marks only the completed ones done (`build.milestones`), and the next build starts where it stopped.
  - **Revenue context:** `REVENUE.md` goes to the builder, so checkout and legal pages land in the MVP.
  - **On the Ideas page,** **Build the MVP (M1–M3)** sits beside **Just M1**.
- **Merges are picked up every tick** (they used to be noticed once a day), so the next build is offered right after a merge.
- **Infrastructure:** a milestone that needs a database or a Google API key gets it from the credential broker (`~/ai-stack/bin/provision neon db <slug>` and so on). The builder may run the broker and nothing else that touches credentials, never sees a value, and lists what it provisioned in BUILD.md under "## Infrastructure" ([provisioning](provisioning.md)).
- **Where it runs: the factory's Docker sandbox** (`policy.build.sandbox: "docker"`, since 2026-10-11).
  - **In the sandbox:** Claude Code, `npm install`, `npm test` and the screenshot run (Chromium is in the image) all run in the same hardened worker as the factory's own jobs (§14 of [autonomous-factory.md](autonomous-factory.md)). It has no mounts, no host environment and no credentials, and its network reaches only the package registries and `api.anthropic.com`, through the egress allowlist.
  - **Login:** Claude logs in with a long-lived subscription token from `claude setup-token`. It's kept in the keychain as `idea-build-claude-token`, Claude Code reports it as `apiKeySource: none` (the subscription), and the free-pool fallback goes through the egress relay.
  - **On the Mac:** idea-factory drives a session through `factory/bin/sandbox-session.ts` (JSON lines: open, put, exec, patch, close). The Mac only clones, applies the patch that comes back, scans it, commits, pushes and opens the PR, so code the builder writes, installs or tests never touches the Mac.
  - **No silent fallback:** no token or no Docker fails the build with the reason; it never falls back to the host.
  - **Host mode:** `"host"` is the old way, kept for emergencies. It runs on the Mac with install scripts off, and there the builder's code can read the Mac's files.
- **Secret scan:** before any commit, the patch is scanned (idea-factory `lib/secret-scan.js`) for two things:
  - credential-shaped strings, fake ones included, because a literal fixture turns a PR's GitGuardian check red;
  - this Mac's real secrets, by value: the build token, LiteLLM's key and the factory env.

  On a hit, the builder gets one repair round: build fakes at runtime, read real values from the environment. If anything's still there, the build fails and no PR is opened. The builder's instructions say the same up front. (dawnlog's M1 on 2026-10-11 put fake keys for its redaction tests in as literals; none was real.)
- **Credential broker in the sandbox:** the builder can't run `~/ai-stack/bin/provision` from inside it. Instead it writes what it needs into `.provision` (the broker's verbs, for this idea's repo only). The Mac checks each line, runs it through the broker after the secret scan, and lists the result in the PR. `.provision` is never committed.

### 5. Revenue

- **Tracking:** RepoHQ already tracks lifecycle and MRR per repo. Each tick, the pipeline:
  - marks a new idea repo `building` (purpose Revenue) in RepoHQ;
  - copies its MRR into `state.json` and the Notion `MRR` column;
  - moves the idea to `live` when the owner sets the repo's lifecycle to beta, production or growing.
- **Reporting:** the morning email's "Ideas, demand and revenue" section shows the whole pipeline.

**The road to revenue** (idea-factory `lib/revenue.js`, `bin/idea-revenue.js`, `lib/launch-facts.js`):
- **The plan:** once an idea's M1 is merged, a Claude Pro run applies gstack's startup frameworks (office-hours forcing questions, plan-ceo-review's scope challenge) to money, at most 2 a day. It writes `REVENUE.md` and `revenue.json`:
  - who pays;
  - the price, anchored on what they pay today;
  - the payment method;
  - what must exist before charging;
  - launch channels;
  - the first ten users;
  - risks and kill criteria.

  It's synced to the Ideas page as the **Revenue plan** tab.
- **The checklist** (`state.launch`, refreshed every tick): plan → MVP → live → legal pages → launch-ready → price → Stripe → launch posted → first user → first dollar. Each step belongs to the agents or to the owner, and is checked automatically where it can be:
  - **from RepoHQ's repo row:** homepage, Stripe product and MRR;
  - **a live-URL probe:** the Vercel production URL, the homepage, then `<repo>.vercel.app` if the owner's team owns it (cached for an hour);
  - **the repo tree:** privacy and terms pages (cached for 6 hours), or the same pages answering on the live site;
  - **the live audit** (go live, below) for launch-ready;
  - **`launch-log.json`** (the launch skill) and signups.
- **Where it shows:** a **Road to revenue** card on each idea's page, with the next step and whose it is, and a line per idea in the morning email.
- **Go live** (idea-factory `lib/golive.js`): once the MVP is merged, one build makes the product launch-ready, and the live site is audited from then on. gstack has no marketing or SEO skill, so this is the pipeline's own step.
  - **The build** (`buildOne({ golive })`, branch `go-live`, one draft PR "Go live: <slug> (launch-ready)") adds what a public launch needs:
    - title, meta description, Open Graph and Twitter tags, a share image, a canonical URL, `sitemap.xml`, `robots.txt` and JSON-LD;
    - privacy and terms pages written for what the app actually collects;
    - a **Buy** button for the plan's price that opens `STRIPE_PAYMENT_LINK` and stays hidden while it's unset;
    - a beacon to RepoHQ's `/api/ideas/signal`, with no cookies, sending three events:
      - `visit`: any public page, once per session;
      - `activate`: the first use of the product's core action, named in LAUNCH-READY.md;
      - `checkout`: a Buy click.

      The referrer is sent only when it comes from another site. Nothing is sent from bots (`navigator.webdriver`), from previews, or from a browser with `localStorage['repohq:notrack']` set (the owner's). Products launched before 2026-10-12 send one `view` from the home page; the growth loop's first mission for them adds the rest;
    - `.provision` lines for its Vercel project (`vercel project <slug>`) and a payment-link request for the owner (`request "Stripe payment link …"`);
    - fresh screenshot proof of the launch-ready site (footer and Buy button included) at the top of the README, checked like a build's;
    - tests, and `LAUNCH-READY.md`: what changed, and what's left for the owner. It's quoted in the PR.
  - **When it runs:** by itself once the MVP is complete and the site isn't launch-ready (`policy.golive.auto`), at most `policy.golive.maxPerDay` (1), closest to money first, never on a tick that already built. Or from **Get it launch-ready** on the Ideas page, once M1 is merged. A merged go-live sets `state.golive`, and isn't built again: from then on the audit says what's left.
  - **After the merge:** the tick finds the production URL with the Vercel CLI (`vercel ls <project> --prod` then `vercel inspect`, the shortest alias, in `policy.vercelScope`, cached for an hour). It sets it as the repo's GitHub homepage if none is set (never overwriting one), which RepoHQ syncs.
  - **The live audit** (`auditLaunch`, every 6 hours, or when the URL changes) checks 9 things: HTTPS, the home page answering, a title, a meta description, `og:image`, `robots.txt`, `sitemap.xml`, `/privacy` and `/terms`. Speed under 2 s and JSON-LD are reported but don't count. All 9 passing ticks **Launch-ready**, and its evidence lists what's missing ("5/9 launch checks · missing: …"). Becoming launch-ready, and a check that used to pass failing, are logged with the tick.
  - **What stays the owner's:** the price, the go-ahead to charge, and posting the launch.
    - The build only files a request for the payment link.
    - With the live key the owner stored, the broker's `provision stripe <repo> <price> --live` makes the link and webhook, puts them in Vercel and redeploys. The success page and webhook go on the public production domain. tiebreak went live this way at $5 once on 2026-10-13.
    - Then the live product is mapped to the repo in RepoHQ, which turns the checklist's payment step green.
- **Build order:** build queues (the weekly slot, approved builds) are ordered by `revenueScore`, so the idea closest to its first dollar goes first, not the one approved first. Demand evidence counts most: a demand test that passed, then signups. Then a plan with a price, then checklist progress, then the review's score.

**The growth loop** (step 5d; idea-factory `lib/growth.js`, `bin/idea-growth.js`, `policy.growth`; [growth-loop-prd.md](growth-loop-prd.md)):
- **The record, every tick:** each focus product's `state.growth` holds:
  - its **stage**: launch, instrument, acquire, activate, monetize, retain or park;
  - the **bottleneck**, in words;
  - the **next mission**;
  - its **experiments**.

  The rules, first match wins:
  1. **Not launch-ready:** nothing; the go-live covers it.
  2. **The last two experiments moved nothing:** the owner decides whether to park it.
  3. **The old one-view beacon:** a funnel-beacon build.
  4. **Under 50 visitors a week:** a launch kit if there's none, then search pages, then "post the next channel". A fresh kit once every channel is posted.
  5. **Visitors but no first use:** a first-screen build.
  6. **Active users but no Buy clicks:** a paid-offer build.
  7. **Buy clicks or MRR:** no missions.

  A tried mission isn't repeated. An abandoned one can come back after a week.
- **One mission a day per product,** from 10:00, at most `maxMissionsPerDay` (2) a day and `maxBuildsPerWeek` (2) growth builds a week. Never on a tick that already built or wrote a revenue plan. Never while something waits for the owner: an open growth PR, or a kit nobody has posted from. `policy.growth.auto: false` stops new missions; `tick --growth` ignores the 10:00 start in tests.
- **The missions:**
  - **A growth build** (`buildOne({growth})`, branch `growth-<experiment id>`, one PR "Growth: <slug> (<kind>)", merged by the pipeline once its checks pass):
    - one change, on Sonnet at high effort, in the sandbox, with no free-pool fallback: its sandbox allows no models, and the egress refuses every model call;
    - the brief goes in the build-input file: the mission, the funnel, `LEARNINGS.md`, `PLAYBOOK.md`'s Rules, and how the same kind of experiment went on other products;
    - the builder keeps the beacon, adds tests, appends to `GROWTH.md` and writes honest copy only;
    - it may only file broker requests;
    - the PR states the hypothesis, the metric now, the target and the window.
  - **A launch kit** (`bin/idea-growth.js`): Claude on the subscription follows the launch skill and can write only `LAUNCH-KIT.md`: no shell, no MCP, no posting.
  - **An owner item:** a line in the morning email's Today block.
- **Experiments:**
  - **When one starts:** recorded as `proposed` before it starts, with the baseline from this week's funnel and the target (50 visitors a week; or half as much again as a share of visitors, at least 10% for activations and 2% for Buy clicks).
  - **Windows:** 14 days by default, 28 for search pages, 7 for the beacon.
  - **What moves them on:**
    - a merged growth PR starts the window, and a closed one abandons the experiment (step 4a);
    - a kit runs from its first logged post after it was written, and is abandoned after 7 days unposted;
    - a build that never opened a PR is abandoned after a day.
  - **Judging** (`judge` in `lib/growth.js`), once the window ends, against the window of the same length before it (`funnelWindow` in `lib/repohq.js`):
    - **visitors a week** (the kit and search pages): at or above the target → keep; anything else → iterate (lift or not is recorded);
    - **a share of visitors** (activations, Buy clicks): needs at least `minSampleVisits` (30) visitors in the window, else it's extended once and then recorded as not enough data. At or above the target → keep; 30% or more worse than before on a first screen or paid offer → revert; otherwise iterate;
    - **the beacon:** kept once a `visit` arrives.

    The result goes in the experiment (`decision`, `decidedAt`, `result`) and as a line in the product's `LEARNINGS.md`, with what else ran in the same window. A kept experiment is proposed under `PLAYBOOK.md` "## Proposed"; moving it to "## Rules" is the owner's call.

The first version created a private repo every night. That would have added about 30 repos a month to a portfolio where RepoHQ already rates 35 of 47 active repos as archive candidates. Now a repo exists only after the owner says yes.

## Deciding: the Ideas page

RepoHQ's [Ideas page](https://repohq.vercel.app/ideas) (`src/app/(app)/ideas/`, owner only) is where the owner reviews and decides. It lists the ideas that need a call first: unreviewed ones, and ones the review passed in the last 14 days that the owner hasn't seen. Then come the running demand tests, builds, live ideas and the passed list. Each idea opens to its review at a glance and tabs for the PRD, research, roadmap, full review, launch post and sources. A decision panel offers **Approve build**, **Demand test first** or **Pass**, or **Agree, keep passed** on an idea the review already passed. Each one confirms what will happen next. Keys: A / T / P to decide, ← → to step through the queue, Esc to go back.

How a decision travels, with Notion staying the board the pipeline follows:

1. The page writes a pending `idea_decisions` row (Neon) and nothing else.
2. On its next tick, at most 15 minutes later, the pipeline sets that Notion Status exactly as the owner would. It marks the row `applied`, or `failed` with the reason. A row still pending can be withdrawn on the page.
3. Step 1 of the same tick follows the new status like any owner change. Build makes the repo on that tick and **starts M1 on that tick too**, within `policy.build.maxPerWeek`, instead of waiting for the next daily run. The approval note goes to the builder with the PRD.
4. The tick mirrors every changed idea (`idea.json`, `state.json`, `review.json`, the markdown docs) to the `ideas` table. It also writes its heartbeat and `policy.json` to `idea_pipeline`, so the page shows how fresh it is.

**New ideas** come from `idea: …` on Slack or WhatsApp (the companion runs `idea-publish.js seed`) or from the page's **New idea** box. The box writes an `idea_seeds` row. The next tick moves it into the same research queue (`seeds.jsonl`) and marks it `queued`. Once it's written up, the tick marks it `researched` and links it to its idea. A queued one shows how many are ahead of it.

**Start build now** is on the Build card of an approved idea whose repo exists. It also appears after a milestone's PR is merged, to build the next one.
- **The request:** the button confirms what happens, takes an optional note for the builder, and writes a pending `idea_build_requests` row.
- **When it runs:** on its next tick, the pipeline takes the oldest pending request, re-checks it (`manualBuildTarget`, the same rules as the page's `buildNowTarget`) and builds that milestone, outside `maxPerWeek`.
- **Limits:**
  - one build per tick;
  - at most `policy.build.manualPerDay` (2) manual starts in any 24 hours, because an Opus build at xhigh can use most of a usage window the owner's own sessions share. Over the cap a request waits, and the reason shows on the page;
  - manual builds don't use the weekly slot.
- **Result:** the row moves `pending → running → done | failed`, with the PR link and the engine, and the PR is posted in Slack (#team-agents). A queued request can be withdrawn. If the weekly slot builds the same idea first, the waiting request is settled with that PR.

**Build the MVP** (one request for every remaining milestone, `milestone: "MVP"`) and **Get it launch-ready** (`milestone: "GOLIVE"`, see [go live](#5-revenue)) sit beside it. They use the same table, cap and queue, so neither needs a schema change. Get it launch-ready appears once M1 is merged and no build or PR is open.

The morning email links to the page when ideas need a call. The tables are in `src/lib/db/schema.ts`; idea-factory's side is `lib/repohq.js`. A table added later (`idea_seeds`, `idea_build_requests`) only needs `npm run db:push`, and the page works without it until then.

## Status lifecycle (Notion `Status`)

| Status | Set by | Meaning |
|---|---|---|
| `Idea` | pipeline | Researched and recorded; review pending. The page has the full research, PRD, roadmap and sources. |
| `Validate` | pipeline (review) or **owner** | Worth a demand test: landing page live, signals counting. The page has the review. The owner can send a reviewed idea here from Idea or Pass. |
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
- **`companion`** (OpenClaw, WhatsApp) never researches. An `idea: …` message is only queued as a seed (`idea-publish.js seed --source slack|whatsapp`), and the pipeline researches it on its next tick.
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
