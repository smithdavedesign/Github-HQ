# Authentication & Integrations

How the assistant authenticates to each service, and how to keep it logged in **like a service account** — set once, never re-auth (mostly).

Related: [roadmap → Integrations](roadmap.md#integrations--the-runs-my-life-leap).

---

## Principle: pick the longest-lived credential

Whether you ever re-authenticate depends on the **credential type**, not the tool. Always prefer the durable option:

| Credential type | Lifetime | Use for |
|---|---|---|
| **API key / Personal Access Token / integration token** | Until revoked (effectively forever) | GitHub, Notion, Anthropic, OpenRouter, Ollama |
| **OAuth refresh token (app in "production")** | Indefinite — auto-refreshes | Google (Gmail/Calendar), personal accounts |
| **Service account + domain delegation** | Truly permanent | Google **Workspace** only (not consumer Gmail) |
| **Session/QR link** | Expires periodically ⚠️ | WhatsApp Web — the one that needs occasional re-link |

> ⚠️ A Google OAuth app left in **"testing"** mode expires refresh tokens in ~7 days. Publish it to **"production"** (unverified is fine for personal use) → the refresh token persists.

---

## Where credentials live

| Store | What | Notes |
|---|---|---|
| `~/.openclaw/openclaw.json` → `skills.entries.<skill>.apiKey` | Skill API keys (Notion, Google Places, Whisper) | Contains secrets — keep `chmod 600`, never commit |
| `~/.openclaw/openclaw.json` → `auth.profiles` | OAuth profiles (mode: oauth) | e.g. `anthropic:claude-cli` |
| `gh` CLI keyring | GitHub token | Managed by `gh auth`; shared with the `github` skill |
| `~/.config/himalaya/config.toml` | Email IMAP/SMTP creds | For the `himalaya` email skill |
| `~/ai-stack/litellm/.env` | Model-provider keys (gitignored) | Anthropic / OpenRouter |
| LaunchAgent plists | Service env (`OLLAMA_API_KEY`, etc.) | Ollama + gateway |

---

## One-stop surfaces

OpenClaw doesn't have Dot/Muse's single OAuth dashboard, but these are the closest:

- **`openclaw configure --section skills`** — interactive, guided credential setup (the practical "one stop")
- **`openclaw tui`** — terminal UI connected to the gateway
- **`openclaw channels login`** — per-channel linking (e.g. WhatsApp QR)
- Direct edit of `openclaw.json` for anything scriptable

---

## Per-integration setup

### GitHub — ✅ ready (no new credential)
Uses the `gh` CLI, already authenticated (persistent keyring token).
```bash
gh auth status        # verify
gh auth login         # only if not logged in
```
Skills: `github`, `gh-issues`. Read is free; **writes (issues, PRs, comments) confirm first.**

### Notion — ✅ ready
Integration token already in `skills.entries.notion.apiKey`. Create/rotate at [notion.so/my-integrations](https://www.notion.so/my-integrations); share the pages/databases you want it to access with the integration.

### Email (Gmail via himalaya) — ✅ live
IMAP/SMTP with a **Gmail App Password** in `~/.config/himalaya/config.toml` (IMAP `imap.gmail.com:993`, SMTP `smtp.gmail.com:465`). Verified (inbox listed). App passwords don't expire → service-account-like.
> **GOTCHA:** App Passwords copied from Google's UI contain **non-breaking spaces** (`U+00A0`), not regular spaces — the value looks 16-char but is really 19. Strip **all** non-alphanumerics down to the 16 real letters (a regular-space strip isn't enough).

### Google Calendar — ✅ live (macOS/EventKit, no OAuth)
Solved natively via **`icalBuddy`** (reads macOS/EventKit calendars; add events via Calendar.app) — **no Google OAuth or app needed**. Any Google calendar you add in macOS **System Settings → Internet Accounts** syncs in automatically. (`gcalcli` is also installed if you ever want Google-native OAuth instead.)

### Slack — 🧭 (bundled skill available, not in original ask)
`slack` skill is bundled; needs a Slack app/bot token (xoxb-…). Long-lived. Good for work-context automation (what OpenAI Dots use).

### Weather / Places — ✅ keyed
`weather`, `goplaces` — API keys already configured.

---

## Keeping it authenticated (the "service account" feel)

1. Use **tokens/keys/refresh-tokens**, never password-based or short session logins where avoidable.
2. For Google, **publish the OAuth app to production** so refresh tokens don't expire.
3. For Google **Workspace**, a real **service account + domain-wide delegation** = never re-auth.
4. Accept that **WhatsApp Web** will need occasional re-linking (`openclaw channels login`) — it's session-based by design.

**How Dot/Muse do it:** cloud-hosted OAuth consent → server-side refresh-token vault → silent auto-refresh. Same underlying OAuth refresh tokens you can use here — they've just wrapped it in a one-tap UI. Our setup wires each service once via `configure`; from then on it behaves the same (persistent).

---

## Security

- `openclaw.json` holds plaintext secrets — `chmod 600`, never commit, back up privately.
- Prefer **scoped** tokens (minimum permissions per integration).
- Rotate anything that's been exposed; revoke unused tokens.
- Read-only where possible; require confirmation for send/write/purchase actions (enforced by the companion's `SOUL.md` boundaries).
