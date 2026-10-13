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
| `provision stripe <repo> <price> [--monthly] [--live] [--success-path P] [--webhook P]` | Stripe product, price, payment link and webhook → `STRIPE_PAYMENT_LINK`, its price label and the webhook secret in Vercel env, then a production redeploy (test mode unless `--live`) |
| `provision stripe remove <repo> [--live]` | deactivate the link, delete the webhook, archive the price and product |
| `provision list [repo]` | what's been provisioned, names and targets only (`~/.config/provision/index.json`) |
| `provision request "<what and why>"` | anything else goes to the owner on Slack (#team-agents) |
| `provision token <name>` | the owner stores a broker token (interactive, no echo) |

**Guardrails:**
- Only repos with the GitHub topic `idea` can be provisioned, plus any the owner lists in `~/.config/provision/allow`. So no agent can touch RepoHQ's or the owner's own projects.
- Names are validated before anything runs.
- Every call is logged with `emit-event` (system `ai-stack`, component `provision`).
- Everything runs in the agent accounts with **no card on file**, so $0 is enforced by the providers, not by trust.

## Stripe

The app never gets a Stripe API key. It sends buyers to the payment link with their account as `client_reference_id`, and the signed webhook grants what they bought.

- **Keys:**
  - The broker holds restricted keys only (`rk_…`): Write on Products, Prices, Payment Links and Webhook Endpoints, nothing else. They can't charge, refund, pay out or read customers. Stripe has no API for making keys, so the owner creates them.
  - Test mode: `provision token stripe` (2026-10-12).
  - Live mode: `provision token stripe-live` (2026-10-13), made with the dashboard's Test mode switched off. A restricted key belongs to one mode.
  - A full `sk_…` key, or a test key in the live slot, is refused.
- **Where the success page and webhook go:** the project's public production domain, a custom domain or its own `*.vercel.app`. Never a deployment URL or the team's aliases (`<project>-<team>.vercel.app`): both redirect to Vercel's login. Before a project's first production deploy only those exist, so the command refuses.
- **The price** is the product's plan (`REVENUE.md`) and the owner's call. The go-live build files a request; the live command runs at the owner's word.
- **Going live from test mode:**
  1. `--live` with the same options as the test setup.
  2. `provision stripe remove <repo>` for the test objects, whose webhook would now fail the live secret.
  3. Map the live product to the repo in RepoHQ, which turns the checklist's payment step green.
- **First live product:** tiebreak, $5 once, 2026-10-13. One-time payments don't count toward RepoHQ's MRR yet.

## Who calls it

- **idea-build** (`bin/idea-build.js`): the builder may run only the broker, and its prompt says when to. A milestone that needs a DB runs `provision neon db <slug>`, and the code reads `DATABASE_URL` from env. Tests never need real values. Anything else becomes a `provision request` plus an env-var stub, recorded in BUILD.md under "## Infrastructure".
- **OpenClaw**: it has full exec, so "set up a database for grantgate" on Slack runs the same verbs (skill `ai-stack`).
- **Claude Code sessions**: the same, from any repo.

Browser-only steps (signing up for a new service, an OAuth consent screen) stay with the owner as a one-time checklist. Revisit browser automation later with Claude Code and the agent Google account, never OpenClaw on free models.

## Goal: agents can provision on their own (steps 1–5)

Set 2026-10-11. Progress is tracked here.

- [~] **1. Agent accounts (owner).** Step-by-step setup is in the ai-stack README under "Provisioning → One-time setup".
  - [x] Google account `1426davejobs.agent@gmail.com`, 2-Step Verification on, password in macOS Passwords (2026-10-11);
  - [x] Neon (Free, no card), API key stored. A personal key works: the broker finds its org;
  - [x] Vercel: the existing Hobby account with a team-scoped token, since a GitHub account links to only one Vercel login;
  - [ ] GCP project with no billing account, plus `gcloud auth login` as the agent account. Only needed once a build wants a Google API;
  - [x] `provision status` shows ✓ for neon and vercel. First live run: grantgate got a Neon DB and a Vercel project with `DATABASE_URL` in its env (2026-10-11).
  - [x] Stripe: one account shared by the ideas, a restricted test key (2026-10-12) and a live key (2026-10-13). tiebreak's payments went live the same day.
- [x] **2. The broker:** `~/ai-stack/bin/provision`, unit tests in `~/ai-stack/bin/tests/test_provision.py` (keychain and APIs stubbed; the main test is that values are never printed).
- [x] **3. Hooked into the builder:** idea-factory `bin/idea-build.js` (allowed tool and prompt). OpenClaw uses it through exec and the `ai-stack` skill.
- [ ] **4. Browser-only checklist:** collect, per new service, the one-time steps with no API as they come up (the first `provision request`s show which).
- [x] **5. Google web-search key into the keychain.** Stored by the owner on 2026-10-11 (keychain service `openclaw-google-websearch-key`). `bin/secrets check` passes: every copy matches the keychain and no backup holds a live secret.

**Not yet:** Supabase, Render and other providers are added as verbs when a build first asks for them (`provision request` shows which).
