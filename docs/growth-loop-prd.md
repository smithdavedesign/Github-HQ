# Growth loop PRD v2

> 2026-10-12 · David Smith. This is a trimmed version of the "RepoHQ Portfolio Director & Continuous
> Improvement System" PRD, grounded in the code and the real funnel. Status: being built in phases (see
> Rollout). The map of the whole system is [system-overview.md](system-overview.md).

The factory builds faster than it distributes: one live product, 3 visitors ever, $0 revenue. v2 adds
one daily growth step to the existing idea pipeline. For each focus product it finds the funnel's
bottleneck, starts one mission, measures the result and records the lesson.

## Where we are

One product is live, and almost nobody has seen it.

| Product | Stage | Price | Funnel | Next step |
|---|---|---|---|---|
| tiebreak | live: MVP and go-live merged | $5 once | 3 unique visitors ever, all on launch day | David: Stripe payment link, then launch posts |
| codespend | MVP, 1 of 3 milestones | $9/month | not live | the weekly build finishes the MVP |
| dawnlog | MVP, 1 of 3 milestones | $12 once | not live | the weekly build finishes the MVP |
| permitly | demand test, decides 2026-10-24 | none yet | 1 of the 50 visitors it needs | posts from its launch kit |
| packpass | demand test, decides 2026-10-26 | none yet | 0 of the 50 visitors it needs | a launch kit, then posts |
| 6 approved ideas | repo created, never built | none yet | none | wait (see Decisions) |

Revenue from ideas is $0. Nothing measures a product after launch, and nothing improves it once its
roadmap is merged. David's one step only he can do, posting, has no daily slot.

## Decisions already made

David set these on 2026-10-12.

- **Focus is tiebreak only.** It is the one live product. The next product joins once its MVP is live.
- **Finish started MVPs; start no new ones.** The weekly build slot finishes codespend and dawnlog and
  their go-lives. The 6 approved ideas wait for a first build until a focus product reaches 50 visitors
  a week. "Start build now" still works.
- **Demand tests keep running.** Posts from their launch kits appear in the Today block, though they
  aren't focus products.

## The loop

```mermaid
flowchart LR
  A["Read the funnel<br/>visits, activations, checkouts"] --> B["Pick the bottleneck<br/>the first rule that matches"]
  B --> C["Start one mission<br/>build · kit · owner"]
  C --> D["David merges or posts<br/>nothing ships without him"]
  D --> E["Measure the window<br/>14 days, 28 for SEO"]
  E --> F["Decide and record<br/>keep · iterate · revert · park"]
  F -->|"next day, the lesson in the brief"| A
```

The loop runs inside the existing 15-minute pipeline tick: once a day per focus product, and at most
two missions a day across the portfolio.

## Rules

Each day, the first rule that matches picks a focus product's one mission.

| Stage | When | Mission | Who does it | Metric |
|---|---|---|---|---|
| Launch | not launch-ready yet | none; the automatic go-live build covers it | none | none |
| Instrument | live, but no visit event ever | add visit, activate and checkout events | build | none |
| Acquire | under 50 unique visitors in 7 days | a launch kit, then SEO pages, then "post the next channel" | kit, build, David | visitors |
| Activate | visitors, but no activations or signups | a landing-page or first-run change | build | activations per visitor |
| Monetize | activations, but no checkout clicks | paywall placement or copy; the price stays David's | build | checkouts per visitor |
| Retain | a checkout click or recurring revenue | no missions | none | none |
| Park | the last 2 experiments showed no lift | recommend parking | David | none |

There are three kinds of mission:

- **Build:** a growth build in the product's repo, in the existing sandbox. It opens a draft PR stating
  the hypothesis, metric, current value, target and window. Merging starts the experiment; closing
  abandons it.
- **Kit:** a headless Claude run that follows the launch skill and writes only `LAUNCH-KIT.md`: ranked
  channels, each community's rules, and one post per channel. David posts by hand.
- **Owner:** a line in the Today block.

David's checklist steps (price, payment link, launch posts) are Today items. They never block a mission
or use its slot.

## Measurement

Every live product reports four events to RepoHQ's existing signal endpoint
(`/api/ideas/signal`), with no cookies.

| Event | Fires when | Tells us |
|---|---|---|
| `visit` | any public page opens, once per session | reach |
| `activate` | the product's core action is first used | first real use |
| `checkout` | someone clicks Buy | intent to pay, not a payment |
| `signup` | someone leaves an email | interest (demand tests and lists) |

- The funnel counts unique visitors per event: the last 7 days, the 7 before, and all time, plus the
  top referring sites. Owner, bot and preview traffic don't count.
- An experiment compares two windows of equal length: before it started and after. Each experiment has a
  minimum sample and an absolute target. Short of data, it is extended once, then recorded as "not
  enough data".
- Revenue is Stripe recurring revenue. One-time payment links such as tiebreak's $5 aren't counted yet;
  a later phase adds them.

## Context

Products share context in three layers, each in a place that already exists.

1. **The product record**, the idea's folder in idea-factory. `state.json` holds the funnel and the
   growth state, including every experiment. `LEARNINGS.md` is an append-only list of what was tried
   and what happened. Both reach RepoHQ's Ideas page and MCP through the existing sync.
2. **The portfolio playbook**, `PLAYBOOK.md`. It holds rules David accepted, plus rules the pipeline
   proposes after a winning experiment. RepoHQ's context search indexes it.
3. **A brief per mission.** Each run gets only what its task needs: the mission, the funnel, the
   product's lessons, the playbook's rules, and how other products' experiments of the same kind turned
   out.

This is how one product's lesson reaches the next. A landing-page change that lifts activations on
tiebreak becomes a proposed rule; once David accepts it, every later landing-page mission sees it.

## David's 10 minutes

The morning email opens with a Today block of at most five items, money first:

- checklist steps for focus products, such as "create tiebreak's Stripe payment link";
- the next channel to post from a launch kit, at most one post a day per product;
- growth PRs to merge;
- experiments that need a decision (revert or park);
- playbook rules to accept.

Everything else the system does stays out of the block.

## Guardrails

- **Money:** $0. Claude runs on the subscription only, and growth runs never fall back to the shared free
  model pool.
- **Never post, spend or merge:** kit runs can write one file, with no shell and no MCP. Builds run in
  the sandbox and open draft PRs. A growth build can only ask David for a credential, never create one.
- **Honest distribution:** posts say a builder is asking. Each community's rules decide whether a link
  goes in. No fake accounts, votes or paid placement.
- **Privacy:** prompts and reports carry counts and site names, never emails or visitor hashes.
- **Caps:** at most 2 missions a day and 2 growth builds a week; one mission in flight per product; never
  on a tick that already built; nothing before 10:00. Growth builds use Sonnet, which leaves Opus for
  MVP builds.

## Kept and cut from v1

v2 keeps v1's principles: extend what exists, one executor, no automatic merge, post or spend, evidence
over activity, and four levels of measurement (activity, output, outcome, revenue). It cuts the platform
v1 would have built.

| v1 proposed | v2 uses instead |
|---|---|
| a Portfolio Director service | the daily growth step in the existing 15-minute pipeline tick, with next-actions, the Advisor and revenue ranking |
| a 20-field mission contract | one experiment entry: hypothesis, metric, baseline, target, window, result, decision |
| a 9-state lifecycle | idea stages, the 10-step launch checklist and 7 growth stages |
| 10 `.ai` files per repo | `state.json` and `LEARNINGS.md` per product, and one `PLAYBOOK.md` |
| a new dashboard | a Growth card on the Ideas page and the Today block in the morning email |
| an experiments database table | experiments inside each product's `state.json`, mirrored by the existing sync |
| a swarm of role agents | the morning report's roles, and one mission per product at a time |

## Rollout

Each phase ships as draft PRs to RepoHQ and idea-factory, and David merges them.

1. **Day 0, no code:** tiebreak's first launch kit; David creates its Stripe payment link.
2. **Phase 0, fixes:** a bug that can rerun the daily steps; go-live builds closing unrelated build
   requests; merges on live products going untracked. Also the new-build hold, and the four funnel
   events in RepoHQ and in future go-live builds.
3. **Phase 1, measurement:** the funnel saved for every live product; the experiment record,
   `LEARNINGS.md` and `PLAYBOOK.md`; funnel lines in MCP; the Today block.
4. **Phase 2, the growth step:** the rules, growth builds, kit runs and caps. tiebreak's first missions:
   its funnel events, then SEO pages for searches such as "PickFu alternative".
5. **Phase 3, outcomes:** experiments judged when their window ends, lessons appended, playbook rules
   proposed; the Growth card on the Ideas page.
6. **Later:** Search Console, a "mark posted" button, one-time Stripe payments counted as revenue,
   research missions.

## Success and stop criteria

| By | Success looks like |
|---|---|
| 2026-10-26 (2 weeks) | funnel events live on tiebreak; its first kit channel posted; its first experiment running |
| 2026-11-23 (6 weeks) | tiebreak at 50 or more visitors a week; the first checkout click; the first payment |

Parking is recommended, and David decides, when two experiments show no lift on real traffic, or a
product is still under 50 visitors a week after 4 weeks of posting.
