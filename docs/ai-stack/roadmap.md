# Roadmap

Where the platform is headed. Organized by horizon, not hard dates. Honest about effort, value, and what's deliberately *not* being done.

**Legend:** ✅ done · 🔜 next (ready to build) · 🧭 exploring (needs a real trigger) · ⏸ parked (deliberate no, for now)

---

## Guiding principles

- **Local-first, $0 by default.** Cloud is an escape hatch, not the default.
- **Prefer free/local models whenever possible.** Casual chat and simple tasks → local or free `cloud-or`. Spend on paid `cloud-smart` only where it's genuinely required — reliable tool-calling (integrations), or quality-critical work. Default to the cheapest model that can do the job.
- **Files are memory.** Durable context lives on disk (`CLAUDE.md`, `USER.md`, memory files) — sessions are ephemeral.
- **Confirm before destructive/outward actions.** Bold internally, careful externally.
- **Hardware is the real ceiling.** On 16 GB, software tuning has limits — don't fight physics.
- **Don't add what overlaps what works.** New components must earn their memory footprint.

---

## Now — housekeeping (mostly quick, mostly yours)

| Item | Status | Notes |
|---|---|---|
| Set Anthropic spend cap | ✅ | Done 2026-10-06: $25/month. |
| Real reboot | 🔜 | Validates auto-start resilience (unproven at 80+ days uptime) **and** clears accumulated swap. See [operations](operations.md#reboot-resilience). |
| Confirm briefing timeout fix | 🧭 | Raised 180→300s; confirm on next scheduled 8 AM run. If it still times out, simplify the prompt or switch its model. |

---

## Next — high value, ready to build

### Autonomy (the main theme — four tracks)
All four were chosen as goals. Shared enabler: reliable tool-calling needs a **cloud model**, so autonomy is not $0 — budget + spend cap first.

| Track | Built on | Status | Next step |
|---|---|---|---|
| **Autonomous coding** | OpenHands + Claude Code workflows | 🔜 | Codify common tasks ("fix failing tests", "migrate X"); run unattended |
| **Scheduled / recurring agents** | OpenClaw cron + Claude Code `/schedule` | ✅ foundation (briefing + companion check-ins) | Add useful jobs: repo/PR monitoring, inbox triage, weekly digest |
| **Personal-assistant automation** | OpenClaw **flows** | 🔜 | Event-driven follow-ups ("remind me", "chase that thread") beyond time-based crons |
| **Event-driven pipelines** | OpenClaw flows / webhooks | 🧭 | On-trigger (new commit / message / webhook → agent acts) |

### Companion V2
| Item | Status | Notes |
|---|---|---|
| Cost trim (`messaging` profile) | ✅ | ~16.4k → 6.9k tokens/msg |
| Richer memory | 🔜 | Structured profile + better recall — the real Dot/Muse "magic" |
| Voice replies (TTS) | 🧭 | Pair with existing Whisper input for full voice loop |
| Event-driven proactivity | 🔜 | Flows that react to events, not just the clock |

### Coding stack
| Item | Status | Notes |
|---|---|---|
| Qwen2.5-Coder-14B | ✅ | GPU-fit at 8k context |
| Continue autocomplete | 🔜 | Small FIM model for in-editor tab completion |
| Local RAG (Qdrant + embeddings) | 🧭 | Only if you repeatedly query a large codebase/doc set |

---

## Integrations — the "runs my life" leap

What separates a companion you *talk to* from one that *acts for you* — and the main thing Dot/Muse do that ours doesn't yet. Good news: **most targets already ship as OpenClaw skills** (installed, but trimmed out by the `messaging` profile). The work is *selectively enabling + authenticating* them on the companion — not building from scratch.

| Target | OpenClaw skill | Access | Status | Notes |
|---|---|---|---|---|
| **GitHub** | `github`, `gh-issues` | read + write (confirm) | 🔜 ready | `gh` already authed (smithdavedesign) — just enable on companion |
| **Email (Gmail)** | `himalaya` | read + send (confirm) | 🔜 | needs Gmail OAuth / app password |
| **Notes** | `apple-notes`, `notion` | read / write | 🔜 ready | Notion key already configured |
| **Reminders / tasks** | `apple-reminders`, `taskflow` | read / write | 🔜 ready | `taskflow-inbox-triage` for triage flows |
| **Weather / places** | `weather`, `goplaces` | read | ✅ available | keys present |
| **Messaging** | `wacli` (WhatsApp), `imsg` (iMessage) | read + send (confirm) | 🔜 | |
| **Google Calendar** | — (not bundled) | read + create (confirm) | 🧭 build/install | enable `clawhub` to install a skill, or add one |
| **Slack / Teams** | — | read + post (confirm) | 🧭 | what Dots use for work context — add if wanted |

### Integration design rules
- **Read freely, write on confirmation.** Reading inbox / calendar / notes is low-risk and bold; sending email, creating events, posting, or purchases always confirm first (per the companion's `SOUL.md` boundaries).
- **Selective enable = cost control.** Each skill adds ~100–200 tokens/message. The companion was trimmed to `messaging` for cost; re-add only the integrations you'll actually use, not all 29.
- **Auth per integration** lives in `~/.openclaw/openclaw.json` / env — treat as secrets, keep out of git.
- **`clawhub` is disabled** (`plugins.allow` excludes it); re-enable it to install new skills (e.g. Google Calendar, Slack).

### Setup status (as of Oct 2026)

**Execution model (done):** all CLI/API integration skills run through the companion's `exec` tool, which is scoped: `tools.exec.security=allowlist` + `ask=on-miss`. Because OpenClaw's exec **shell-wraps** commands (`/bin/sh -c …`), binary-path allowlisting can't auto-match — so each new command **prompts for approval** on WhatsApp. Reply **`/approve <id> allow-always`** once per command and the system persists the correct rule (Dot/Muse-style). This gating is the intended security for an externally-reachable agent; CLI-driven approval isn't possible (must be the WhatsApp/gateway channel).

| Integration | Credential | Status | Remaining |
|---|---|---|---|
| Scoped exec policy + `exec` enabled | — | ✅ done | — |
| **GitHub** (`gh`) | `gh` keyring | ✅ **verified** (as `smithdavedesign`) | Enroll via `/approve … allow-always` on first WhatsApp use |
| **Notion** | `NOTION_API_KEY` | ✅ **verified** (workspace connected) | Same approval enrollment |
| **Gmail** | App Password + authorized connection | ✅ **verified both paths** | companion-native himalaya live (inbox listed). _Gotcha: App Passwords copy with non-breaking spaces — strip all non-alphanumeric to 16 chars._ |
| **Apple Notes / Reminders** | — (local) | ✅ working | runs via osascript through gated exec; no secret |
| **Calendar** | macOS/EventKit (`icalBuddy`) | ✅ **verified** | add-events via gated Calendar.app; Google syncs in via macOS Internet Accounts |
| Anthropic spend cap | — | ✅ done | $25/month, set 2026-10-06 |

_Slack was not in the original ask (gmail/github/calendar/notes) — available as a future add via `channels.slack` + bot token._

### Model economy (serves "use free when possible")
Integrations currently force the companion onto **paid `cloud-smart`** (free `cloud-or` won't reliably call tools), and enabling `exec` pushed input back to ~16k tok/msg. To honor free-first:
- **Exec is a toggle** — turn it *off* for lean, free/local chat (~7k tok); *on* only when you want the companion to act.
- 🧭 **Explore capability-based routing:** companion chats on **local/free**, and escalates to `cloud-smart` *only* when a turn needs tool-calling/integration. Would give free-by-default with paid only on action.

---

## Later — conditional

| Item | Status | Trigger |
|---|---|---|
| **Hardware upgrade (32–64 GB)** | 🧭 | *If* local 7–14B proves insufficient in daily use. Unlocks 30B-class coders that rival frontier — the single biggest level-up, but a purchase, not a config. |
| **Observability (Prometheus/Grafana)** | ⏸ | Parked — eats the memory that's already tight; revisit only with more RAM or a separate box. |
| **Dify** (LLM app/workflow platform) | ⏸ | Evaluated and parked — overlaps OpenHands/OpenClaw and its 6–8 container stack won't fit 16 GB. Reconsider on a bigger machine if a visual workflow builder is wanted. |

---

## Done (shipped this far)

- Tuned Ollama (Flash-Attn, q8 KV, keep-alive ∞) — fixed the original 85 s/request bug
- Unified gateway: Headroom → LiteLLM, 5 models, cost-ladder fallback
- Agents wired: OpenCode, Continue, Aider, OpenClaw companion, OpenHands (on-demand)
- Cloud escape hatches (free OpenRouter + paid Anthropic), web search (patched)
- Reboot-resilient auto-start for all services
- Personal companion (persona + memory + proactive check-ins), cost-trimmed
- **All requested integrations live & verified** — GitHub, Gmail, Calendar (macOS/icalBuddy), Notes/Reminders, Notion
- **Full agentic access** for the companion — writes code + runs commands + spawns sub-agents in any repo (owner-granted, ungated; reconfirmed 2026-10-09)
- **Free-model pool** (RepoHQ factory) — agentic coding across Ollama Cloud / OpenRouter / Gemini free tiers
- **Vercel MCP** configured for Claude Code + OpenCode (OAuth activation pending)
- **RepoHQ factory front door — both sides** — message "work on repo X" → **draft PR → WhatsApp**, end to end.
  - *OpenClaw side:* `~/ai-stack/repohq/frontdoor.py` (enqueue/report/status) + `CONTRACT.md` + companion dispatch + 15-min report scheduler. Unit-tested (8/8).
  - *Factory side* (merged to Github-HQ `main` in #18): new `owner-requested` task kind runs through the one governed path — sandbox → free-pool → judge → draft PR (labeled `owner-requested`, never auto-merged) → ledger. Free-form gate = the judge's generic rules (checks pass, no regression, diff ≤ 400 lines, no CI/secret/lockfile edits, no test gutting). `factory/lib/owner-requests.ts` + hooks in `run.ts`/`tasks.ts`/`config.ts`/`ledger.ts`; `verify.ts` unchanged. Unit-tested; all existing factory tests still pass. Capability defaults to `report` (a dry run: runs sandbox+judge, holds the PR, reports "verified") — promote to `pr` after a clean night to open labeled draft PRs.
- Cross-session context: `CLAUDE.md`, Copilot instructions, Claude Code memory, `/ai-stack` skill
- This documentation (moved into Github-HQ `docs/ai-stack/` on 2026-10-07; the `ai-stack-docs` repo is retired)
- **Agent HQ (Github-HQ roadmap Phase 81)** — the factory is the only agent executor. RepoHQ's "Run agent", the skill launcher and MCP queue through the same front door as OpenClaw (an `agent_requests` row + a BullMQ job for the factory worker on this Mac), and OpenClaw's JSONL requests are mirrored there too. Nexus (AI-Took-My-Job on Render) is retired ([agent-hq-migration-prd.md](../agent-hq-migration-prd.md), trade-offs in [agent-hq-tradeoffs.md](../agent-hq-tradeoffs.md))

### Open / next
- ~~**Merge the factory front-door branch**~~ — done (#18). Owner requests run at stage `report` (verified, held) until `owner-requested` is promoted to `pr` in `factory/factory.config.json`.
- **Vercel deploy** — activate the MCP (OAuth) *or* issue a full-scope token (current token is read-only); then wire `/setup-deploy` + env vars
- **Sentry** (error tracking) — `sentry-cli` installed; needs a DSN to integrate
- ~~**Event triggers**~~ — shipped as factory **Phase 78**: red CI, Dependabot alerts and stale bot PRs are sensed every cycle. The front door stays the owner-initiated path
- ~~**Anthropic spend cap**~~ — done 2026-10-06 ($25/month); the companion runs on paid `cloud-smart`
- **Security:** the full-exec companion reads untrusted content (owner accepts the risk); WhatsApp is allowlisted, Slack DMs use pairing, the gateway is loopback-only, and the LiteLLM key is rotated and out of git

---

_See [README](README.md) for the current architecture and [operations](operations.md) for the runbook._
