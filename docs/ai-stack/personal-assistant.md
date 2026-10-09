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
| Agent | `companion` (OpenClaw) | Isolated agent, model `local/cloud-smart` |
| Gateway | `ai.openclaw.gateway` :18789 | Always-on; routes WhatsApp → companion |
| Workspace | `~/.openclaw/workspace-companion/` | Persona + memory files |
| Channel | WhatsApp (allowlisted number) | Text + voice (Whisper transcription) |

### Persona & memory (files loaded every session)

| File | Purpose |
|---|---|
| `SOUL.md` | Personality — warm, honest, low-friction, proactive |
| `USER.md` | Your profile; seeded with observed preferences, grows as it learns you |
| `MEMORY.md` | Curated long-term memory (main/private sessions only) |
| `memory/YYYY-MM-DD.md` | Daily raw notes |

Because memory is **file-based**, even scheduled/isolated runs stay in-character and context-aware — no live conversation thread required.

---

## Agentic access: approve on first use

Since 2026-10-09 (owner's choice) the companion's commands are **approved on first use**: `tools.profile=coding`, `tools.exec.security=allowlist`, `tools.exec.ask=on-miss`. It can still **write and edit files, run shell commands and spawn coding sub-agents in any repo**. A command it hasn't run before asks on WhatsApp first; reply **`/approve <id> allow-always`** once and that command runs freely after that (rules persist in `~/.openclaw/exec-approvals.json`). This keeps "just do it" for what you've approved while blocking surprise commands from prompt-injected content.

- Documented for the agent in `~/.openclaw/workspace-companion/TOOLS.md`.
- **Security boundaries (the only thing guarding this):** WhatsApp allowlisted to one number; gateway bound to **loopback** only.
- **Risk:** it reads untrusted content (email, web, Notion), so a prompt injection could try to run a command; with approvals on, a new command now has to get past you. Already-approved commands still run unattended, so approve broad commands (`sh`, `bash`, `curl | …`) with care.
- **Slack** DMs use pairing (unknown senders need a one-time code), not "open" (2026-10-08).
- **History:** scoped exec (`allowlist` + `on-miss`) → full, ungated access → back to approve-on-first-use (2026-10-09, after the security review).

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

> **Note:** the proactive crons are prompted to use **memory only** (no tool calls). Reason: once the companion got full exec, it would try to *check* calendar/email during a cron, which (under the old approval gate) hung until timeout and nothing delivered. Memory-only keeps them fast and reliable. Live calendar/email summaries in proactive messages are a future refinement.

```bash
openclaw cron list                        # see jobs
openclaw cron run <job-id>                # fire one now (sends a real WhatsApp)
openclaw cron edit --id <id> --cron "..."  # change schedule
```

---

## Using it

Just message it on WhatsApp like a person. It will:
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
- **Privacy:** the companion runs locally, but because it uses a cloud model, **conversation content goes to Anthropic.** For fully private operation, switch it to a local model (`local/local-coder`) — at the cost of warmth/memory quality. This is the core trade-off of a 16 GB machine.

---

## Roadmap ideas (V2+)

- **Trim skills** on the companion to cut per-message cost and latency.
- **Richer memory** — structured profile + better recall (the real Dot/Muse "magic").
- **Voice replies** (TTS) to complement Whisper input.
- **Event-driven follow-ups** via OpenClaw flows (not just time-based crons).
