# Personal Assistant (Companion)

A private, memory-rich personal companion — Dot/Muse-style, but **self-hosted and only for the owner**. Built on [OpenClaw](https://docs.openclaw.ai), reachable on WhatsApp, powered by Claude (`cloud-smart`).

See the [companion diagram](architecture.md#personal-assistant).

---

## What it is

- A **dedicated OpenClaw agent** (`companion`), separate from the coding `main` agent.
- **WhatsApp is routed to it** — your phone talks to the companion; coding happens in your CLI/IDE agents.
- **Actively engaged**: proactive morning + evening check-ins, follows up on open threads, learns you over time.
- **Model:** `cloud-smart` (Claude Sonnet) for genuine warmth, nuance, and reliable memory/tool use.

---

## How it works

| Piece | Where | Role |
|---|---|---|
| Agent | `companion` (OpenClaw) | Isolated agent, model `local/free-agent` (the free cloud pool), falling back to `cloud-or` → `local-coder` → `cloud-smart` |
| Gateway | `ai.openclaw.gateway` :18789 | Always-on; routes WhatsApp **and Slack** → companion |
| Workspace | `~/.openclaw/workspace-companion/` | Persona + memory files |
| Channel | WhatsApp (allowlisted number) | Text + voice (Whisper transcription) |
| Channel | **Slack** (socket mode, app `repoHQ-message`) | Channel **#team-agents**: answers only when @-mentioned, and only to the owner's Slack user. DMs: pairing (unknown senders need a one-time code). Also where system alerts land ([logging](../logging.md)). |

### The system brief

The companion's `AGENTS.md` ends with a generated block between `system-brief` markers (RepoHQ `factory/context/brief.ts`). It covers the goal, the parts, the rules, what's failing now, the ideas in flight, and how to look things up (`~/idea-factory/bin/context`, `~/ai-stack/bin/system-status`).
- The morning report rewrites it daily, and the system-events collector rewrites it whenever something starts failing or recovers. The main agent gets the same block.
- `agents.defaults.contextInjection` is `always` (2026-10-10; it was `continuation-skip`), so the workspace files, and the brief with them, go with every turn, not just a session's first. That costs about 6k extra input tokens a turn, free on the free pool.
- Revert: `openclaw config set agents.defaults.contextInjection continuation-skip`.

### Persona & memory (files loaded every session)

| File | Purpose |
|---|---|
| `SOUL.md` | Personality — warm, honest, low-friction, proactive |
| `USER.md` | Your profile; seeded with observed preferences, grows as it learns you |
| `MEMORY.md` | Curated long-term memory (main/private sessions only) |
| `memory/YYYY-MM-DD.md` | Daily raw notes |

Because memory is **file-based**, even scheduled/isolated runs stay in-character and context-aware — no live conversation thread required.

---

## Full agentic access ⚠️

The companion runs with **full, ungated access** (owner's explicit choice, confirmed again 2026-10-09): `tools.profile=coding`, `tools.exec.security=full`, `tools.exec.ask=off`. It can **write and edit files, run any shell command and spawn coding sub-agents in any repo, with no approval prompts.** To require approval on first use instead: `openclaw config set tools.exec.security allowlist`, `openclaw config set tools.exec.ask on-miss`, then restart the gateway.

- Documented for the agent in `~/.openclaw/workspace-companion/TOOLS.md`.
- **Security boundaries (the only thing guarding this):** WhatsApp allowlisted to one number; gateway bound to **loopback** only.
- **Risk (accepted by the owner):** it reads untrusted content (email, web, Notion) *and* has full exec, so a prompt injection could run code. Keep it off untrusted inboxes and pages.
- **Slack** DMs use pairing (unknown senders need a one-time code), not "open" (2026-10-08).
- **History:** scoped exec (`allowlist` + `on-miss`) → full, ungated access. Briefly back to approve-on-first-use on 2026-10-09, then full again the same day (owner's choice: no prompts).

## Integrations (live)

The companion acts on real services via its CLIs/APIs. Read-only is free; it asks in plain language before irreversible/external actions.

| Integration | How | Status |
|---|---|---|
| **GitHub** | `gh` CLI | ✅ `smithdavedesign` |
| **Gmail** | `himalaya` (IMAP/SMTP, App Password) + authorized Google connection | ✅ inbox verified |
| **Calendar** | `icalBuddy` reads macOS/EventKit calendars; Calendar.app to add | ✅ (Google syncs via macOS Internet Accounts) |
| **Notes / Reminders** | osascript (local) | ✅ |
| **Notion** | Notion API (`NOTION_API_KEY`) | ✅ workspace connected |

See [authentication.md](authentication.md) for credential details and the non-breaking-space App Password gotcha.

---

## Proactivity (scheduled)

Cron jobs run *as the companion* and deliver to WhatsApp:

| Job | Schedule | What |
|---|---|---|
| `companion-morning` | 7:30 AM daily | Warm good-morning, asks your focus (memory-only) |
| `companion-evening` | 9:00 PM daily | Wind-down, how the day went (memory-only) |
| `morning-briefing` | 8:00 AM daily | (separate) AI/tech briefing with web search |
| `idea-to-repo` | 9:00 AM daily | Runs as **`scout`**, not the companion. It starts the idea research on Claude Pro (`idea-research.js`); if that fails, scout researches on the free pool itself. The idea lands on the Notion Idea Board, and the idea pipeline (launchd, every 15 min) then reviews it, demand-tests it and builds it. See [Idea factory](../idea-factory.md). |

**`scout`** is a separate OpenClaw agent (workspace `~/.openclaw/workspace-scout/`). It has no `USER.md` and no memory, and its cron job may only use `exec`, `read`, `write` and the Ollama web tools. It reads untrusted web pages, so it is kept away from the companion's personal context. The companion only queues `idea: …` messages for it (`idea-publish.js seed`); agent-to-agent messaging stays off.

> **Note:** the proactive crons are prompted to use **memory only** (no tool calls). Reason: once the companion got full exec, it would try to *check* calendar/email during a cron, which (under the old approval gate) hung until timeout and nothing delivered. Memory-only keeps them fast and reliable. Live calendar/email summaries in proactive messages are a future refinement.

```bash
openclaw cron list                        # see jobs
openclaw cron run <job-id>                # fire one now (sends a real WhatsApp)
openclaw cron edit --id <id> --cron "..."  # change schedule
```

---

## Using it

Message it on WhatsApp, in a Slack DM, or by @-mentioning it in **#team-agents**, like you would a person. It will:
- Ask your name and invite you to name *it* on first contact.
- Remember what matters and bring it forward naturally.
- Be direct and honest (no sycophancy) — tuned to how the owner likes to be dealt with.

Test from the CLI without WhatsApp:
```bash
openclaw agent --agent companion --message "hey" --thinking off --json
```

---

## Cost & privacy

- **Cost:** ~16k input tokens/message on `cloud-smart` (persona + bundled skills + tool schemas) ≈ **$0.05/msg**. A chatty day can reach a few dollars. Mitigations: trim unused skills (big win), or set a hard cap at [console.anthropic.com](https://console.anthropic.com) → Billing.
- **Privacy:** the companion runs locally, but its model is the free cloud pool (`free-agent`: Ollama Cloud, OpenRouter free, Gemini free; then `cloud-or`). **Conversation content and the persona/memory files go to those providers**, and free tiers may log or train on prompts. `cloud-smart` (Anthropic, which doesn't train on API data) is only the last fallback. For fully private operation, switch it to a local model (`local/local-coder`), at the cost of warmth and memory quality. This is the core trade-off of a 16 GB machine. What the companion may read at all is set by the [personal context policy](../personal-context.md).

---

## Roadmap ideas (V2+)

- **Trim skills** on the companion to cut per-message cost and latency.
- **Richer memory** — structured profile + better recall (the real Dot/Muse "magic").
- **Voice replies** (TTS) to complement Whisper input.
- **Event-driven follow-ups** via OpenClaw flows (not just time-based crons).
