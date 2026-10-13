---
name: portfolio-context
description: |
  The big picture of the owner's system: what it's for (products people use and pay for, near-zero
  owner overhead, no financial risk), how the parts fit (RepoHQ, the factory, the idea pipeline,
  the Resource Center, the local AI stack, OpenClaw), the rules every part follows (money, models,
  data classes, who merges), and how to look up live context. Use at the start of work in any of
  the owner's repos (Github-HQ/RepoHQ, idea-factory, resource-center, ai-stack, OpenClaw
  workspaces, or any repo RepoHQ tracks), or when asked about the big picture, priorities,
  ideas, revenue, "what should I work on", or how the system works.
---

# Portfolio context

1. **Read the map.** `/Users/davidsmith/Documents/Repos/Github-HQ/RepoHQ/docs/system-overview.md`
   (or the MCP tool `get_system_overview` from the `repohq` server, which adds live counts). It has
   the goal, the loop, where each part lives, the rules, the scorecard and the schedules.
2. **Look things up; don't guess.**
   - `search_context` (MCP) or `npm run context -- search "<query>"` in RepoHQ searches repos, ideas,
     bookmarks and docs. Public and personal only; work data is for local models.
   - `get_repo_context` / `get_next_action` (MCP) give one repo's health and the next useful step.
   - `get_idea_pipeline` (MCP) gives every idea's stage and demand test; with a slug, visitors by source, launch posts and its **road to revenue**.
   - **From idea to money** (docs/idea-factory.md): approving a build builds the whole MVP in one sandbox run. When M1 merges, a revenue plan is written (`REVENUE.md`: who pays, the price). Once the MVP is complete, a go-live build makes it launch-ready (SEO basics, privacy and terms, payment link, visit beacon, Vercel project), and the live site is audited every 6 hours.
   - **The growth loop** (docs/growth-loop-prd.md): for focus products, a daily mission picked from the funnel (a growth build, a launch kit, or a step for the owner), each an experiment judged when its window ends (`LEARNINGS.md`, playbook proposals). The morning email opens with what the agents did overnight.
   - **Every built idea has a checklist** to the first dollar (`state.launch`, the Road to revenue card): the next step says whose it is. The owner's steps are the Stripe product, posting (the `launch` skill drafts the posts) and a price decision.
   - Each idea is in full in `~/idea-factory/ideas/<slug>/` (research, PRD, roadmap, review, state).
3. **Follow the rules:**
   - **Spending:** agents never spend or hold a card. The owner may put a few hundred dollars into moving a
     product forward (idea-factory `policy.json` ownerBudget, 300 per product, his call 2026-10-12): propose the
     spend and what it should buy, and he approves and pays. Free tiers otherwise. (Written without the dollar
     sign: skill loading would replace it with the first argument.)
   - **Claude work on the Pro subscription, never API credit.** Strip `ANTHROPIC_API_KEY`; the
     reference is `idea-factory/lib/claude.js`.
   - **Data classes:** never send employer work data to a cloud model; never touch financial data.
   - **Who merges:** everything merges itself on the owner's repos (his call, 2026-10-13: "full send").
     The factory and the idea pipeline merge their own PRs once tests and every check are green, and
     revert what breaks. In an interactive session you open a PR so CI runs, merge it yourself once CI
     is green, and do the deploy step; he reviews afterwards. Never force-push or delete.
   - **The owner's decision on RepoHQ's Ideas page overrides any verdict** (no Notion since 2026-10-12).
4. **Logs, alerts, backups and secrets** ([docs/logging.md](/Users/davidsmith/Documents/Repos/Github-HQ/RepoHQ/docs/logging.md)):
   - **One log:** every system writes to `~/.system-events/events.jsonl`; the collector ships it to Neon `system_events` every 5 minutes.
   - **Probes:** services, launchd jobs, OpenClaw crons, GitHub crons, Vercel deploys, provider errors, secrets.
   - **Alerts:** failures and recoveries post to Slack **#team-agents**, which is also where the owner talks to the companion.
   - **Check the state first** when something seems off: `get_system_status` (MCP) or `~/ai-stack/bin/system-status` (failing now, 24 h per system) and `npm run events -- tail` in RepoHQ.
   - **Write events from new code:** TypeScript `emitEvent` (`factory/system/events.ts`), idea-factory `lib/events.js`, shell `~/ai-stack/bin/emit-event <system> <component> <event> <ok|fail|info> "<message>"`. Log what happened or failed, not quiet runs.
   - **Secrets:** the keychain is the source; `~/ai-stack/bin/secrets check | rotate litellm`. Never paste a key into a file or a commit.
   - **Backups:** private repos `ai-stack`, `repohq-factory-state` (nightly) and `idea-factory`.
5. **Keep the picture true.** If you change how a part works, update `docs/system-overview.md` (and
   the scorecard if a layer got stronger or weaker) in the same PR.
