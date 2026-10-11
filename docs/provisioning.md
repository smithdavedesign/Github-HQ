# Provisioning: how agents get databases and API keys

Part of the [system overview](system-overview.md). Agents will build whole products, so at some point they need a database, an API key or a deploy target. They get them from a **credential broker**, not from passwords: `~/ai-stack/bin/provision`.

## The rule

**Agents never see a secret.** The broker does one fixed thing per verb with a scoped token from the keychain and writes the secret it makes straight to where it's used: the keychain (`provision/<repo>/<KEY>`), the repo's Vercel env, or its GitHub Actions secrets. It prints what it did, never a value. Why not a password wallet for OpenClaw's browser:

- whatever a browsing agent types or reads goes to its model provider, and OpenClaw runs on free cloud models;
- a web page can carry a prompt injection, and an agent holding passwords is the worst target for one;
- a password is the whole account (mail, billing, recovery), while a scoped token can be revoked on its own;
- 2FA, captchas and console redesigns break browser logins, and free models recover from them worst.

## Verbs

| Command | Does |
|---|---|
| `provision status` | which broker tokens and CLIs are ready (yes/no only) |
| `provision neon db <repo>` | Neon project (free tier) → `DATABASE_URL` in the keychain, and in Vercel env if the project exists |
| `provision vercel project <repo>` | Vercel project (Hobby) linked to the GitHub repo; pushes every value already stored for the repo |
| `provision vercel env <repo> <KEY>` | a stored value → the repo's Vercel env (production, preview, development) |
| `provision github secret <repo> <KEY>` | a stored value → GitHub Actions secret (value on stdin, never in argv) |
| `provision gcp key <repo> <api> [KEY]` | enable a Google API in the agent GCP project, create a key restricted to it |
| `provision list [repo]` | what's been provisioned, names and targets only (`~/.config/provision/index.json`) |
| `provision request "<what and why>"` | anything else goes to the owner on Slack (#team-agents) |
| `provision token <name>` | the owner stores a broker token (interactive, no echo) |

**Guardrails:**
- Only repos with the GitHub topic `idea` can be provisioned, plus any the owner lists in `~/.config/provision/allow`. So no agent can touch RepoHQ's or the owner's own projects.
- Names are validated before anything runs.
- Every call is logged with `emit-event` (system `ai-stack`, component `provision`).
- Everything runs in the agent accounts with **no card on file**, so $0 is enforced by the providers, not by trust.

## Who calls it

- **idea-build** (`bin/idea-build.js`): the builder may run only the broker, and its prompt says when to. A milestone that needs a DB runs `provision neon db <slug>`, and the code reads `DATABASE_URL` from env. Tests never need real values. Anything else becomes a `provision request` plus an env-var stub, recorded in BUILD.md under "## Infrastructure".
- **OpenClaw**: it has full exec, so "set up a database for grantgate" on Slack runs the same verbs (skill `ai-stack`).
- **Claude Code sessions**: the same, from any repo.

Browser-only steps (signing up for a new service, an OAuth consent screen) stay with the owner as a one-time checklist. Revisit browser automation later with Claude Code and the agent Google account, never OpenClaw on free models.

## Goal: agents can provision on their own (steps 1–5)

Set 2026-10-11. Progress is tracked here.

- [ ] **1. Agent accounts (owner, about 30 min).** Each one separate from the owner's own accounts, with no card on file:
  - [ ] a Google account for agents;
  - [ ] a Neon org → API key → `provision token neon` (and `neon-org` if the key isn't org-scoped);
  - [ ] a Vercel team or Hobby account with the GitHub app on the idea repos → token → `provision token vercel` (and `vercel-team`);
  - [ ] a GCP project with no billing account → `provision token gcp-project`, then `brew install --cask google-cloud-sdk` and `gcloud auth login` as the agent account;
  - [ ] check: `provision status` shows ✓ for neon and vercel.
- [x] **2. The broker:** `~/ai-stack/bin/provision`, unit tests in `~/ai-stack/bin/tests/test_provision.py` (keychain and APIs stubbed; the main test is that values are never printed).
- [x] **3. Hooked into the builder:** idea-factory `bin/idea-build.js` (allowed tool and prompt). OpenClaw uses it through exec and the `ai-stack` skill.
- [ ] **4. Browser-only checklist:** collect, per new service, the one-time steps with no API as they come up (the first `provision request`s show which).
- [ ] **5. Google web-search key into the keychain.** It's registered in `bin/secrets` as `google-websearch` (keychain service `openclaw-google-websearch-key`, copy in `~/.openclaw/openclaw.json`). The owner stores it once, then `bin/secrets check` keeps the copy honest. Consider rotating it, since it has sat in plain text.

**Not yet:** Supabase, Render, Stripe and other providers are added as verbs when a build first asks for them (`provision request` shows which).
