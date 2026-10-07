# RepoHQ — Roadmap

> **Updated 2026-10-07.** RepoHQ is a personal tool (audit §9.2), and the factory is its only executor (Phase 81: Nexus, the `AI-Took-My-Job` repo, is retired). Shipped Phases 1–59 and G1–G8 are in [roadmap-history.md](roadmap-history.md). The current design is in [architecture.md](architecture.md).

## Next 30 days: four experiments (2026-10-07 → 2026-11-06)

The roadmap stopped being a list of phases. For the next 30 days everything serves one proof: **RepoHQ finds work you actually care about, and the factory turns that work into changes you're glad it made.** Each experiment has a pass mark, and failing one is a useful answer too: it says where the leverage isn't.

| | Experiment | Pass mark (by 2026-11-06) | How it's measured | Built for it |
|---|---|---|---|---|
| **A** | Can RepoHQ identify valuable work? | Each week it surfaces 1–3 things you'd actually do | "What to do next" in the morning email and on the dashboard; you act on it or you don't | Decision states with reasons (`src/lib/portfolio/next-actions.ts`) ✅ |
| **B** | Can the factory execute that work well? | ≥ 50% of resolved factory PRs merged, and rated PRs average ≥ 2/5 | `value:0`–`value:5` label on merge → ledger + `agent_jobs.value`; acceptance and value in the report | PR value rating (`src/lib/agents/pr-value.ts`, reconcile) ✅ |
| **C** | Can it run unattended? | Night-shift gate passes: 7 consecutive sandboxed nights **and** the quality half (≥ 5 resolved PRs, ≥ 50% accepted, ≥ 3 rated, average value ≥ 2) | `nightShiftReadiness` in `npm run factory:report` and the morning report | Stricter gate (`factory/lib/night-shift.ts`) ✅ |
| **D** | Does it produce leverage? | Useful PRs per night trend up, at ≤ $25/month and a review load you don't resent | Useful PRs/night, median hours to your decision, PRs you had to edit | KPIs (`factory-kpis.ts`); open-PR queue so nothing gets lost ✅ |

**Your part (the experiment can't run without it):**
- Rate every factory PR you merge with one label, `value:0` (noise) … `value:5` (material). The PR body and the morning email remind you.
- Merge or close what's in "Your review queue" (top of the morning email, and **Needs you** on the dashboard). Aging PRs (7+ days) are flagged.
- Leave the Mac on AC power overnight; finish the Phase 81 cutover and the trial week.
- Run `bash factory/bin/setup-email.sh <gmail>` once if the morning report isn't reaching your inbox.

**Frozen for the 30 days:** billing and multi-tenancy (Distribution D1–D5), valuation, simulation, goals and CEO-report work (collapsed under "More insights" on the dashboard), new agent frameworks or executors, always-on infrastructure, auto-merge (trust ladder levels 3+), and new roadmap phases.

**The one infrastructure change allowed during the window: a RepoHQ GitHub App for factory PRs** (Phase 66). Factory PRs are opened with your own `gh` login, and GitHub never lets a PR's author approve it. So "require a review before merging" on `main` (Phase 65's L4 backstop) would block every factory PR or force an admin bypass. The opt-in fine-grained token doesn't help, since it's still you. A bot identity:
- lets you approve factory PRs, so branch protection can be switched on;
- separates bot work from yours in the history;
- has GitHub enforce that the factory never approves its own work.

It's small, doesn't touch the experiments, and unblocks the branch-protection item below.

**After the window, in this order:** opt-in paid escalation for owner requests, then per-service worker health probes (both Phase 81), then let the 30 days of data decide between dropping Redis and an always-on host.

**Next candidate once A–D have data:** a deterministic cross-repo duplicate scan (shared dependencies, near-identical modules, repeated auth/GitHub-client code across the 66 repos). Embeddings stay deferred until the cheap version shows the signal exists.

### Carried over from the history

Still-open items from Phases 1–59, with where they stand:

| Item | Status |
|---|---|
| Phases 9 / 16: 30-day health trend lines on Analytics | Bug, not "waiting": snapshots stopped while the crons were disabled (Aug 14 – Oct 6). Data accumulating again; usable early November |
| Phase 46-E: auto-queue + batch approval | Deferred: its gate (6 months at 80% accuracy) was set for Nexus |
| Phase 48-E: real-time merge detection via GitHub App webhooks | Deferred with Distribution D1 |
| Phase 49: email digest on critical events, weekly briefing email | Partly covered: the factory's morning email now leads with your review queue and next actions |
| Phase 54 T5: pgvector semantic repo matching | Deferred: revisit after the deterministic cross-repo scan |
| G8: 2-hop skill chaining | Cut (auto-chain removed in Phase 81) |

## Autonomous Factory Roadmap

Turns the closed loop into a cost-aware autonomous factory: a local lane on the Mac running against the local AI stack (`~/ai-stack`), a local → free cloud → paid model ladder, learned routing, and the PRD's trust/identity/budget guardrails. Design: [autonomous-factory.md](autonomous-factory.md). Operator guide: [factory/README.md](../factory/README.md).

**Shipped approach (2026-10-05):** rather than first splitting Nexus into queue lanes, the local lane shipped as a standalone runner (`factory/`) that reuses RepoHQ's pure routing code and mirrors its activity into `portfolio_events`. The Nexus lane split (61-B) is deferred until the local runner proves its merge rate.

**Status (2026-10-07):** Factory v2 (Phases 75–80) shipped in #13 and #15: the sandboxed worker, Judge v2 with an adversarial reviewer, the promotion ladder, sensors and a ranked queue, the `agent_jobs` record with KPIs, and the night-shift policy. Next is the night shift's gate (7 consecutive nights with every attempt sandboxed; 2/7 on 2026-10-07), then concurrency 2. Plan of record: [autonomous-factory.md §14](autonomous-factory.md#14-factory-v2-one-good-pr-while-the-owner-sleeps-2026-10-06).

**Audit (2026-10-06, updated 2026-10-07):** [audit-2026-10.md](audit-2026-10.md) found the scheduled crons disabled since Aug 14, `gstack-self` failing daily on a deleted repo, and critical framework advisories in production. The whole fix-now list shipped the same day (Github-HQ #20, AI-Took-My-Job #28; status table at the top of the audit). Open: the §9 decisions (one executor, personal tool vs product) and the owner actions below.

**Owner actions that unblock the most:**
- ~~Close the pre-fix Nexus no-op PRs (Phase 69b).~~ Done 2026-10-06: 11 closed.
- Leave the Mac on AC power overnight; scheduled cycles skip on battery (Phase 80).
- ~~Set the Anthropic console spend cap (Phase 60).~~ Done 2026-10-06: $25/month.
- Run `bash factory/bin/setup-email.sh <gmail>` so the morning report is emailed (Phase 69).
- Optional: branch protection on `main` (Phase 65), and decide on Nexus's auto-chain (Phase 78). Dependabot alerts were enabled on all 9 repos on 2026-10-06.

**Gate to start Horizon 3 (Phase 67):** ≥ 80% of merged agent PRs produced at $0 over 30 days, and zero unapproved L4 actions.

### Phase 60 — Foundation Fixes
- [x] **Nexus: gstack scripts never invoked `claude` when it was installed.** Commit `1e9210e` left the `--print` call inside the `else` branch of all 9 `scripts/gstack-*.sh`. Fixed with regression test `tests/integration/gstack-claude-invocation-check.sh` (0/9 on old code → 9/9); merged in AI-Took-My-Job #19 and released to `main` in #23.
- [x] Removed the stale `tests/integration/gstack-openclaw-routing-check.sh`
- [x] Anthropic console monthly spend limit: $25 (set 2026-10-06; was the $200,000 default, about 5× the last 30 days' $5.23)
- [x] LiteLLM: factory aliases `free-agent`, `free-agent-b`, `local-agent` live in a managed block with **free-only** fallbacks (`free-agent → free-agent-b`); the hand-maintained `local-coder → cloud-or → cloud-smart` ladder stays for interactive use only

### Phase 61 — Free Model Lane (local runner)
- [x] `free-agent` / `free-agent-b` selected by eval (Phase 64), not by hand
- [x] Local runner `factory/run.ts`: sense (repo's own typecheck/lint/test + README) → task → route → execute → verify → draft PR → learn; allowlist, kill switch (`~/.repohq-factory/PAUSE`), one PR per cycle, process lock shared with the scout
- [x] Harness (`factory/lib/harness.ts`): M0 → Aider (`--edit-format diff`) on `local-agent`; M1/M2 → Claude Code `--bare --strict-mcp-config` through LiteLLM with tool allow/deny lists (no commit/push/rm/web)
- [x] Cost + model telemetry per attempt (`tier, harness, model, tokens, costUsd, durationMs, exploring`) in the ledger and RepoHQ `agent_attempt` metadata
- [x] Free-tier 429 / quota exhaustion → defer to the next cycle; **never** escalates to paid. Quota is read from OpenRouter's `/api/v1/key` before every M1 task
- [x] launchd schedules (`factory/bin/install-launchd.sh`; first schedule 18:00 + 03:00, superseded by Phases 69 and 80), `caffeinate -i` per run, standard priority; deployed to `~/.repohq-factory/app` because launchd can't read `~/Documents`
- [x] First live draft PR from the scheduled loop: [AI-Took-My-Job#10](https://github.com/smithdavedesign/AI-Took-My-Job/pull/10) (M0, $0)
- [-] ~~61-B: Nexus BullMQ lanes `agent-local` / `agent-cloud`~~ Cut 2026-10-07: the factory is the only executor (Phase 81)
- [ ] Dedicated `ai-agent` macOS user for the runner (needs sudo; runs as the owner today, confined to `~/.repohq-factory/work`)

### Phase 62 — Free Intelligence Layer (RepoHQ on Vercel)
- [x] `openrouter` provider (`src/lib/ai/providers.ts`, `adapter.ts`, Settings → AI Provider). OpenAI-compatible; `OPENROUTER_BASE_URL` / `OPENROUTER_MODEL_FAST` / `OPENROUTER_MODEL_CAPABLE` overrides (point at LiteLLM in dev)
- [x] Gemini free tier noted in the provider hint (zero-code free option)
- [x] Structured-output guard `src/lib/ai/structured.ts`: extract (fences, `<think>`, prose) → validate → one repair retry → `claude-haiku-4-5` fallback via the server key. Wired into advisor, digest, CEO report, analysis and summary

### Phase 63 — Learned Routing + Escalation Ladder
- [x] `src/lib/agents/model-router.ts` (pure, 22 tests): `classifyRepoData`, `allowedTiers`, time-decayed `computeTierStats`, `chooseTier` (cheapest proven ≥ 80% over ≥ 10, cold start cheapest, ~10% exploration one tier down), `nextTier`, `canUsePaidTier`
- [x] Escalation M0 → M1 → M2 within a cycle; M2 blocked unless `monthlyBudgetUsd > 0` (default 0) → `approval_needed` + RepoHQ notification
- [x] Data-classification gate: private repos skip M1 unless `allowFreeCloud`; `Client Work` / `sensitive` never use M1; unknown visibility treated as private
- [x] Dead-end detection: ≥ 2 M1+ failures per repo+kind in 14 days (M0 failures don't count; they escalate)
- [x] Verification judge (`factory/lib/verify.ts`): target check passes, no regressions, no `@ts-ignore`/`eslint-disable`/`.skip`/`.only`, no lockfile/CI/env edits, ≤ 400 lines; README edits must be additive with only real scripts/tools and no placeholders
- [x] `/agent-performance`: "Autonomous Factory by Model Tier" table (attempts / verified / merged / closed / cost), free-tier share, current `free-agent` (`src/lib/agents/factory-stats.ts`); merge/close outcomes are stamped onto the RepoHQ event during reconcile
- [ ] Feed factory tier stats into the RepoHQ advisor accuracy table

### Phase 64 — Model Scout + Eval Harness
- [x] `factory/scout.ts`: OpenRouter free + `tools` models → preflight → eval suite (seeded bug, multi-file fix, read-only report) → rank with 21-day history → update `free-agent` / `free-agent-b` → commit `~/ai-stack` → `model_scout_report` event
- [x] Quota-aware: evaluates only as many models as today's free requests allow; rotates untested models in; falls back to history when quota is exhausted; keeps (or demotes) incumbents rather than leaving no alias
- [x] `factory/eval/e2e.sh`: full cycle against a local fixture repo (M0 fixes a seeded type error → judge → squashed commit)

### Phase 65 — Trust, Approvals & Budget
- [x] Budget ledger: monthly paid cap (default $0) enforced before every M2 attempt; M2 cost computed from token usage
- [x] Human boundary: `approval_needed` ledger entry + RepoHQ in-app notification (fans out via the existing outbound webhook)
- [x] Draft-only PRs; the factory never merges, force-pushes or deletes branches
- [x] `awaiting_approval` lifecycle stage in RepoHQ
- [ ] Signed, single-use approval links. A first `/approve/[token]` page was removed in the 2026-10 audit: nothing issued tokens, approving changed nothing downstream, single-use lived in per-instance memory, and the secret fell back to a hard-coded string. Rebuild when the factory actually pauses for approval: a dedicated required secret, DB-backed single use, and the approval recorded where the factory reads it
- [ ] OpenClaw → WhatsApp relay for approvals (needs owner sign-off before any outbound WhatsApp)
- [ ] Branch protection on `main` for every allowlisted repo (L4 backstop). Owner action via GitHub settings. **Blocked by the Phase 66 GitHub App:** while factory PRs are authored by your login you can't approve them, so a required review would block them

### Phase 66 — Agent Identity & Secrets
- [x] Secrets read at runtime only: the OpenRouter key from `~/ai-stack/litellm/.env` (into an HTTP header), the RepoHQ DB URL from `.env.local`; never written to prompts, logs or new files
- [x] `op run` support in the launchd wrapper (`FACTORY_OP_ENV_FILE`)
- [ ] 1Password `AI-Agent` vault + service account (owner action), then move both secrets into it
- [ ] **Next (prioritised 2026-10-07):** factory PRs authored by a dedicated RepoHQ GitHub App instead of the owner's `gh` login. Contents/PR/label write on the allowlisted repos only; installation token minted per run on the Mac; Copilot calls keep your login. Unblocks Phase 65 branch protection (an author can't approve their own PR), separates bot work from yours, and lets GitHub enforce "the factory never approves its own work". Supersedes the opt-in fine-grained token, which is still your identity. The Nexus App retires with Nexus (create a new one rather than repurposing it)

### Phase 68 — Redundant Free Model Pool ✅
OpenRouter's 50 free requests/day can't be the single brain. M1 became a LiteLLM pool across independent free providers (design: [autonomous-factory.md §3.1](autonomous-factory.md#31-the-free-model-pool-no-single-quota-is-a-point-of-failure)).
- [x] Managed LiteLLM members for **Gemini** (AI Studio free tier), **Ollama Cloud** (free plan, OpenAI-compatible endpoint) and **OpenRouter**, alongside local Ollama (`factory/lib/litellm-config.ts`, pool ids like `ollama-cloud:nemotron-3-super`)
- [x] Scout discovers and probes candidates on all three providers, evaluates them, and writes a **provider-diverse** chain `free-agent → free-agent-b → free-agent-c` (`pickPool`); skips models tested in the last 3 days
- [x] Explicit fallback ladders (LiteLLM doesn't chain fallbacks recursively): `free-agent` → rest of pool; `cloud-or` → pool; `local-coder` → pool → `cloud-smart` (paid last). Verified live: an exhausted OpenRouter request was served by Ollama Cloud in the same call
- [x] Factory defers M1 only when no pool member has capacity (`m1Deferred`)
- [x] OpenClaw default agent: `local-coder → free-agent → cloud-smart` (was `→ cloud-or →`), via OpenClaw's validated config CLI
- [x] Route Claude Code's small-model role to local Ollama: `local-small` alias (same resident Qwen as `local-agent`, falls back to the pool), wired via `ANTHROPIC_DEFAULT_HAIKU_MODEL` / `ANTHROPIC_SMALL_FAST_MODEL` for M1. **Measured saving: zero.** In headless `--bare` runs Claude Code makes *no* small-model calls (a bogus alias there never reached LiteLLM). Free requests are spent one per agent turn (11–19 per task), so the levers are fewer turns and more providers, not offloading background calls. Kept as insurance.
- [ ] Optional: one-time $10 OpenRouter credit (1,000 free requests/day) to deepen the OpenRouter member. Owner decision
- [ ] Later: move the worker stack into an AI dev VM with the Mac as control plane (§8). Needs more RAM or a second machine

### Phase 69 — Copilot, Reviewer, Morning Report, Agent Lockdown ✅
Toward the Architect / Builder / Reviewer / Operator team (docs/autonomous-factory.md §13), starting with the roles that are measurable today.
- [x] **OpenClaw agent lockdown** (before adding any agents): `tools.agentToAgent = {enabled: false, allow: []}`, `tools.sessions.visibility = "tree"`, `session.agentToAgent.maxPingPongTurns = 1`, each agent may spawn only its own sub-agents. Applied via the validated config CLI; `openclaw doctor`: 0 errors
- [x] **MC tier = GitHub Copilot CLI** (prepaid seat) between free cloud and paid: locked down (`--disable-builtin-mcps`, no git writes, deny beats allow), ≤ 6 tasks/day; passed 2/2 fix evals with `gpt-5-mini`
- [x] **Reviewer = GitHub Copilot code review**, requested on every factory PR (works on drafts), ≤ 8/day; results recorded in the ledger during reconcile
- [x] **deps-audit**: every npm scan runs `npm audit`; high/critical → deterministic `npm audit fix` (no model, never `--force`), judged on package files only, advisories must drop, no regressions
- [x] **Morning report**: one update per gstack role (PM → Architect plan, Builder, QA, Reviewer, Security, Ops, Retro) from the ledger, with local-model headlines; saved to `~/.repohq-factory/reports/` and emailed via himalaya + Gmail app password in the keychain
- [x] Schedule: cycles hourly 20:00–05:00 plus 12:00/16:00, ≤ 1 PR per cycle, ≤ 8 per factory day (07:00–07:00); report 06:45 (extended to 06:00 and AC-only in Phase 80)
- [ ] Owner: run `bash factory/bin/setup-email.sh <gmail>` once (needs a Gmail app password)
- [ ] Builder ← Reviewer loop: turn Copilot's line comments into a follow-up commit on the same branch
- [ ] Copilot coding agent (assign an issue to `@copilot`) for tasks every local tier failed

### Phase 69b — First-Night Hardening ✅
Fixes from the first scheduled night (details: [autonomous-factory.md §12](autonomous-factory.md#12-what-building-it-changed-2026-10-05)).
- [x] Nexus gstack scripts strip the injected RepoHQ brief before anything is committed (AI-Took-My-Job #19, merged); `CLAUDE.md` back to `@AGENTS.md` (Github-HQ #12, merged)
- [x] Factory: `lint-autofix` deterministic task for repos whose lint script runs a fixer; deps PRs discard check side effects
- [x] Factory: README judge/prompt read sub-package `package.json` files; `voided` attempts for verdicts later shown to be judge bugs
- [x] Factory: quota-aware Copilot (builder and reviews pause at 0% premium requests); "no quota" = rate-limited, not a failure
- [x] Factory: push / `gh pr create` retry on network errors; `caffeinate -ims`; README "Overnight runs need power"
- [x] QA: environment-dependent test failures (missing secrets / network) are reported, not tasked; the judge rejects early returns in test files
- [x] Close the 11 pre-fix Nexus agent PRs whose only change is the injected brief (closed 2026-10-06)

### Phase 70 — Shared Branch Governance (Integration First) — superseded 2026-10-06
> Replaced by a single PR to `main` per change. Squash-merged releases meant every `integration/agent → main` PR conflicted with the last one, and each change needed two PRs. `integration/agent` and the Main Release Gate are gone from Github-HQ and AI-Took-My-Job; agents open draft PRs against the default branch, the owner merges, and the factory-path guard for autonomous branches stays.

- [x] Standard branch policy across all repos: autonomous work branches use `feature/bot/{taskId}-{slug}`
- [x] Add an integration landing branch standard: `integration/agent` (alias allowed: `feature/bot` only if the repo already uses it as integration)
- [x] All autonomous PRs target `integration/agent`; no autonomous PR may target `main`
- [x] Human gate remains only for `integration/agent -> main` promotion PRs: the Main Release Gate workflow requires the `human-reviewed-release` label, which exists in Github-HQ and AI-Took-My-Job and was first used to release AI-Took-My-Job #23
- [-] Add branch cleanup policy: TTL, max concurrent bot branches, and stale-branch sweeper (scaffold preview endpoint shipped in Nexus)
- [x] Add CI/promotion guard that rejects autonomous PRs to `main` with a clear policy message
- [x] Policy also recognises Nexus's real branch names (`nexus/agent-task-*` via `nexus/*`) and `factory/*`; the factory now names branches `feature/bot/factory-…` and targets `integration/agent` when a repo has it

### Phase 71 — Agent Visibility v2 (Full Behind-the-Scenes Telemetry)
> Reduced 2026-10-07: Phase 81's Agents page shipped the per-request and per-run trace timelines and automation panel. Only the items below still apply, and Nexus execution IDs and chain depth no longer exist.

- [ ] Expand Agent History with full execution timeline: queued, preparing, running, report-ready, pr-ready, merged, failed, timed-out, needs-human
- [ ] Persist and surface per-run telemetry: model tier, tokens, cost USD, duration, retries, escalation reason, chain depth
- [ ] Add a factory trace panel on `/agent-performance` with per-stage timings and retry chains
- [ ] One-click traceability from an Agent History event to its request, run and trace (`metadata.taskId` is already the `agent_requests` id; Nexus execution IDs no longer exist)
- [ ] Add operator filters for source (`repohq-advisor`, `repohq-auto-dispatch`, `skill-chain`, `self-scan`, `mcp`)

### Phase 72 — Run-Until-Complete Autonomous Loops
- [x] Add bounded retry orchestration for recoverable failures (lint/test/network/transient CI) with default max attempts = 3
- [x] Add terminal-state policy with explicit stop reasons (`merged`, `failed`, `timed_out`, `needs_human`, `rejected`)
- [x] Add auto-repair chaining policy that continues execution until objective complete or retry budget exhausted
- [x] Add loop kill-switch and per-repo retry budget controls in Settings
- [x] Add anti-loop safeguards: chain-depth cap, duplicate-objective suppression, and cooldown windows

### Phase 73 — gstack as Default Orchestrator
- [x] Make gstack the default autonomous execution path for advisor-dispatched tasks, with per-skill allowlist by repo (`resolveAdvisorSkill` + repo tag policy `gstack-allow:*` + env override map)
- [x] Add policy tiers for auto-run skills (`report-only`, `analyze+fix`, `high-risk`) and enforce by repo lifecycle + confidence (auto-dispatch now gates by tier + lifecycle + impact accuracy band)
- [x] Add progressive autonomy controls: low-risk skills auto-run by default, high-risk skills require explicit per-repo opt-in (`gstack-optin:high-risk` tag or `REPO_GSTACK_HIGH_RISK_OPT_IN_JSON` override)
- [x] Add cross-skill objective continuity so downstream skills inherit prior findings and unresolved blockers (auto-chain now carries inherited findings + blocker context into objective and contextNotes)

### Phase 74 — Notion Execution Ledger (System of Record)
> **Cut 2026-10-07** (audit §8): `agent_jobs` plus `ledger.jsonl` are already the system of record, and a third copy adds sync bugs. Revisit only if the owner wants Notion as a read-only view.

- [ ] Introduce a Notion execution database as source of truth for autonomous runs across repos
- [ ] Auto-sync one canonical record per run with required fields: taskId, trigger, repo, skill, branch, PR links, timeline, retries, terminal state, outcome delta
- [ ] Enforce writing standards on summaries: objective, acceptance criteria, confidence, rollback notes, final outcome
- [ ] Add bidirectional links from RepoHQ Agent History to Notion records for auditability
- [ ] Add weekly governance report: autonomy throughput, merge-to-main approvals, regression rate, and documentation completeness

### Factory v2 — One Good PR Overnight (Phases 75–80)
Plan of record from the 2026-10-06 architecture review: harden and measure the existing loop instead of adding agent roles. Order: sandbox → verification → fixed pipelines → economics → learning → night shift. Design and rationale: [autonomous-factory.md §14](autonomous-factory.md#14-factory-v2-one-good-pr-while-the-owner-sleeps-2026-10-06).

**Standing limits for every phase below:** spawning depth 1 (Director → worker), fixed pipelines only, $0 budget, ≤ 8 PRs per factory day, merge is always human, `PAUSE` kill switch, the factory never edits its own judge/loop/router.

### Phase 75 — Self-Protection & Promotion Ladder ✅
- [x] Judge rejects factory diffs to `factory/**` and `src/lib/agents/model-router.ts` in the factory's home repo (Github-HQ is on its own allowlist); test in `tests/unit/factory.test.ts`
- [x] CI backstop: the Autonomous PR policy fails `feature/bot/*`, `nexus/*`, `factory/*` PRs that touch those paths
- [x] Per-capability stage in `factory.config.json` → `capabilities` (`observe` / `report` / `pr`), enforced by the Director: `observe` = sensed and logged, `report` = runs and is judged but opens no PR (held results in the morning report), `pr` = draft PRs. Proven task kinds start at `pr`; `red-ci`, `security-alerts`, `adversarial-veto` start at `report`
- [x] Morning report "Director" section: each capability's stage, its 30-day evidence, and promote/demote advice (`factory/lib/ladder.ts`). The factory never changes a stage itself

### Phase 76 — Sandboxed Worker (Docker) ✅
Repo code no longer runs on the owner's Mac. Operator guide: [factory/README.md "Sandbox"](../factory/README.md#sandbox); design: [autonomous-factory.md §14.3](autonomous-factory.md#143-the-sandbox-as-built-phase-76).
- [x] Job image `factory/docker/worker.Dockerfile`: Node 22 + git + Aider 0.86.2 + Claude Code 2.1.291 + pnpm, non-root `worker` user; tag = hash of the Dockerfile (edits rebuild automatically, superseded tags pruned); prebuilt by `install-launchd.sh` / `npm run factory:sandbox:build`. Node only for now (Python/Go later)
- [x] Repo streamed in with `tar` (never bind-mounted); no `~/.ssh`, `~/.aws`, `~/.config/gh`, keychain or Docker socket; the worker gets only the per-command env overrides, never the host environment (`proc.ts` `env` is now overrides-only, `Runner` abstraction)
- [x] **No GitHub credential in the container**: the host keeps clone / commit / push / `gh pr create`; the sandbox's result comes back as a binary-safe patch applied to the host clone (`applyPatchAndCommit`, file contents only) and is judged there
- [x] Network: worker on an `--internal` network; egress container (`egress.Dockerfile`) proxies only `sandbox.allowHosts` (npm + yarn registries) and relays LiteLLM **for an allowlist of model aliases** (free tiers; the paid alias only with a budget). Found while building: the LiteLLM key is a guessable constant, so without the model filter any repo script could spend on `cloud-smart`
- [x] Install, baseline checks, the harness (Aider / Claude Code), post-fix checks, lint autofix and `npm audit fix` all run inside; `confirmFailures`, `runAudit`, working-tree git ops take the sandbox `Runner`
- [x] Limits: `--cpus 4`, `--memory 4g` (no extra swap), `--pids-limit 1024`, `--cap-drop ALL`, `no-new-privileges`, in-container `timeout` per command, PID 1 = 90-min `sleep`; containers + network removed after every repo, crash leftovers swept at cycle start
- [ ] Per-container disk quota: not available on Docker Desktop's overlay2 (`--storage-opt size`); bounded by the Docker VM disk, writable layer deleted after each repo
- [x] Concurrency 1 (serial cycle); revisit after a clean week
- [x] Docker down → cycle skipped and logged; never falls back to the host. `FACTORY_SANDBOX=off` exists for trusted fixtures only
- [x] Copilot builder (MC) excluded while sandboxed (it needs the owner's GitHub login); Copilot PR review unaffected
- [x] Ledger / RepoHQ events record `isolation: docker | host`; `/agent-performance` shows where the latest run executed and how many attempts were sandboxed
- [x] Tests: unit (`tests/unit/factory-sandbox.test.ts`: container args, no-env-leak, timeouts, lifecycle, runner injection, config), live isolation check (`npm run factory:sandbox:check`, 13 properties), sandboxed end-to-end cycle (`npm run factory:e2e`: M0 fixes a seeded type error inside the container, host judges and commits, no `node_modules` on the host), Playwright (`tests/e2e/phase76-sandbox.spec.ts`)

### Phase 77 — Judge v2 (deterministic first, adversarial last) ✅
Rules in `factory/lib/judge-rules.ts`; reviewer in `factory/lib/adversary.ts`.
- [x] Test integrity: no snapshot rewrites; a touched test file may not lose assertions; no mocks of the project's own modules
- [x] Type escapes: no new `as any` / `: any` in source files for type and lint fixes (found by the live adversary test: the seeded e2e error "fixed" with `as any` passed every older rule)
- [x] Diff sanity: no deleted source files, no removed exports, unscoped fixes stay within 3 files of the ones their errors named, no mass reformatting by the model (the repo's own fixer output stays allowed)
- [x] Dependency validation: new bare imports must be declared dependencies (or `@types/…`, or Node builtins); new relative imports must resolve to a tracked file (TS/ESM `.js`→`.ts`, `index.*`)
- [x] Coverage may not drop more than 0.5 points where the test script already prints an Istanbul summary
- [x] Advisory adversarial pass after the rules pass: a different model family from the builder (M0 → `free-agent`; M1/MC/M2 → `local-qwen3`) answers a 10-question "prove this should NOT merge" checklist; every issue must quote the diff or it's dropped; PASS → nothing, UNCERTAIN/FAIL → `needs-careful-review` label, FAIL rejects only once `adversarial-veto` is promoted to `pr`. Never approves; any error = no signal. Live: both reviewers passed an honest fix and failed an `as any` cheat with quoted evidence
- [x] Judge regression suite: `factory/judge-fixtures/` (every past incident from §12 plus one case per rule, 18 fixtures) replayed by `tests/unit/judge-regression.test.ts`; every attempt saves its judge inputs and `npm run factory:judge-fixture -- <attemptId> --expect=…` turns a wrong verdict into a fixture

### Phase 78 — Fixed Pipelines & New Sensors ✅
Sensors in `factory/lib/sensors.ts` (read-only `gh` on the host).
- [x] Fixed pipelines: every task kind is sense → one worker step → verify → PR (`PIPELINES` in `factory/lib/tasks.ts`); the Director picks, a worker never chooses what runs next
- [x] Sensor: red CI on the base branch (latest completed run per workflow) → `red-ci`. At stage `report`: a sandboxed root-cause investigation on the free pool (structured report; file changes from reproducing it are discarded). At stage `pr`: a fix whose oracle is the failing workflow passing on the PR (recorded by reconcile as `ci_oracle`). First live run: a correct root cause for Figma-Jira's CI with file:line evidence
- [x] Sensor: Dependabot alerts → morning report Security section; "disabled" is reported, not hidden (all 9 repos today: owner action). Fixes go through `deps-audit`, so `security-alerts` only reports
- [x] Sensor: stale bot PRs (autonomous branch, open 7+ days, no review) → reported, and that repo gets no new factory PRs until they're handled (`blockOnStaleBotPrs`, default on). First live run: 5 of 9 repos blocked by the old Nexus PRs
- [x] Cross-repo opportunity queue (`rankOpportunities`): red CI > security > deps > failing checks > never scanned > docs, × RepoHQ health (lower health → higher), plus an age bonus that stays below the gap between categories
- [ ] Deferred: feature pipeline (`/plan-eng-review`, report-only until an oracle exists) and performance pipeline (`/benchmark`, needs baselines)
- [x] Decision for the owner: Nexus's `suggestedNextSkill` auto-chain was dynamic chaining. Removed with Nexus in Phase 81 (2026-10-07): skill reports only suggest a next skill, the owner decides

### Phase 79 — Factory Economics & the Job Record ✅
- [x] `agent_jobs` table (`src/lib/db/schema.ts`; idempotent migration `factory/sql/0001_agent_jobs.sql`, generated by drizzle-kit, applied with `npm run factory:migrate`): one row per attempt with parent job (escalation chain), pipeline, tier, model, isolation, requests, tokens, cost, verdict, PR, reviewer, outcome, human commits, timings. `npm run factory:backfill-jobs` copied the ledger's 22 attempts. `ledger.jsonl` stays the source of truth
- [x] Request count per attempt: Claude Code `num_turns`, Aider round trips, one per Copilot prompt, zero for deterministic fixes
- [x] KPIs (`src/lib/agents/factory-kpis.ts`): overnight yield, acceptance, merged per 100 free requests, median review hours, PRs that needed your edits, autonomy. On `/agent-performance` (cards) and as the morning report's Retro headline
- [x] Coarse routing key: difficulty (simple / medium / hard) × tier (`difficultyOf` in `model-router.ts`); deterministic fixes and investigations no longer count as model skill
- [x] Overlaps Phase 71 (telemetry) for factory runs; 71 keeps the Nexus side (retired in Phase 81)

### Phase 80 — Night Shift v2 (gate in progress)
`factory/lib/night-shift.ts`.
- [-] Gate, sandbox half: Phases 75–77 done ✅; 7 consecutive nights with every attempt sandboxed — tracked by `nightShiftReadiness` in `npm run factory:report` and the morning report (0/7 on 2026-10-06 (the night before ran on the host), 2/7 on 2026-10-07)
- [x] Scheduled cycles 20:00–06:00 (plus 12:00, 16:00): skipped on battery (`factory.sh`; `FACTORY_REQUIRE_AC=0` overrides), refused if the sandbox is off, always $0 whatever the manual budget, ≤ 8 PRs, human merge, `PAUSE`
- [x] Gate, quality half (added 2026-10-07, Experiment C): over the last 30 days ≥ 5 resolved factory PRs, ≥ 50% merged, ≥ 3 rated with a `value:N` label, average value ≥ 2. `ready` needs both halves (`qualityGate` in `factory/lib/night-shift.ts`)
- [x] Success measure: 30-night yield and acceptance trend (last 15 nights vs the 15 before) in the morning report; useful PRs per night once PRs are rated
- [ ] Only then: concurrency 2

### Phase 81 — One Agent System (Nexus migration) (code ✅, cutover pending)
The factory becomes the only executor, and Nexus's queue infrastructure (Redis/BullMQ, worker) moves into this repo. Audit §9.1, decided 2026-10-06. PRD: [agent-hq-migration-prd.md](agent-hq-migration-prd.md).
- [x] Infra in this repo: `render.yaml` (Redis Key Value, `noeviction`, auth + TLS), `docker-compose.yml` (dev Redis on 127.0.0.1), shared queue contract `factory/lib/queue.ts` (id-only jobs, no `server-only`, no connection at import)
- [x] `agent_requests`, `automation_runs`, `trace_events`, `agent_jobs.request_id` (`factory/sql/0002_agent_hq_queue.sql`, idempotent, matches drizzle's DDL)
- [x] `factory/worker.ts`: BullMQ worker (request / cycle / report / scout), job schedulers from `schedules` replace the launchd calendar, PAUSE/AC/lock/Docker gates, environment problems defer instead of failing, Neon reconcile on start and after each cycle, 60 s heartbeat; `install-launchd.sh` installs it (KeepAlive) when a `REDIS_URL` exists
- [x] Request mode in `run.ts` (`--request=<id>`): the owner task only; fix skills through the ladder and judge, report skills (`owner-report`) as a read-only investigation; step traces (`::trace::`) and a `::result::` line
- [x] RepoHQ enqueues into the factory (Run agent, gstack launcher in fix + report modes, Monday auto-dispatch and the weekly retro/health, MCP `queue_gstack_skill`); allowlist + owner gate (`FACTORY_USER_ID`); `/canary` unavailable; auto-chain and the CI-fix loop removed (CI failures on agent PRs escalate to `needs human`)
- [x] Agents page (`/agent-performance`): automation panel (worker, queue counts, schedulers, recent runs, owner controls: run now, pause/resume), requests (cancel, retry), per-request and per-run trace timeline; crons recorded as runs (`withAutomationRun`); 36 h factory-freshness banner
- [x] Nexus removed from this repo: dispatch, webhook, task polling, `NEXUS_*` env, the Nexus card halves and the morning report's Nexus line (now Agent HQ request outcomes); docs updated
- [x] Validation: unit tests for the guards, routes, actions and lifecycle; flow tests (`tests/flow`) that run the migration, the app, the real worker and the browser UI end to end on a throwaway Postgres + Redis (`npm run test:flow`, `npm run test:flow:e2e`, CI job `flow`)
- [x] Review fixes (2026-10-07):
  - Dead ends count per request, so two failed requests no longer block the next one on the repo for 14 days.
  - The 36 h banner counts finished cycles and requests only, so Docker being down no longer silences it; the morning report raises it too.
  - An agent PR failing CI (`needs_human`) blocks its repo until it's merged or closed.
  - The weekly `/retro` and `/health` pick allowlisted repos (focused first), not the first rows.
  - Requests honour `blockOnStaleBotPrs` when they would open a PR.
  - The Agents page poll keeps one Redis connection per server instance.
- [ ] Owner cutover (2026-10-07: Redis is up and the worker is installed under launchd, KeepAlive, connected to the Render Redis with 9 repos; Nexus `/health` returns 503, likely suspended. Still to confirm: `REDIS_URL` + `FACTORY_USER_ID` in Vercel, Nexus retired, `AI-Took-My-Job` archived. **Nexus teardown checklist:** remove `NEXUS_*` and the webhook secret from Vercel; delete the Render web, worker, Postgres and MinIO services once the trial week is judged (keep the Key Value); revoke or repurpose the Nexus GitHub App and its tokens; archive `AI-Took-My-Job` after closing its open PRs; drop the `nexus/*` branch handling from the autonomous-PR policy only after no `nexus/*` branches remain): Redis from the Blueprint, `REDIS_URL` + `FACTORY_USER_ID` in Vercel, `npm run db:push` + `npm run factory:migrate`, `install-launchd.sh`, suspend then retire Nexus on Render, archive `AI-Took-My-Job` (runbook: PRD §11)
- [ ] Promote `owner-requested` to `pr` once fix requests verify reliably (until then they end `verified`, no PR)
- [ ] Trial week: keep Nexus suspended and fill in the scorecard ([trade-offs](agent-hq-tradeoffs.md#judging-the-trial-week)), then decide the next step from it
- [ ] Opt-in paid escalation for requests the owner starts (every source but `auto-dispatch`): local → free → paid only on failure, a per-request ceiling inside a monthly cap; the night shift stays $0 ([trade-offs](agent-hq-tradeoffs.md) recommendation 2)
- [ ] Worker health: LiteLLM, Ollama, Neon and GitHub probes in the heartbeat and on the Agents page, self-restarts for LiteLLM and Docker, reconcile on wake (recommendation 3)
- [ ] Later, if needed: an always-on worker host; a cycle that yields to a waiting request; Redis replaced by a Neon poll (recommendations 6–8). Not during the 30-day window.
  - **Redis → Neon poll:** the case for dropping Redis is a monthly bill and a failure mode: Render's Key Value proxy silently dropping the connection is what hung the heartbeat on 2026-10-07.
  - **Caveat:** Neon suspends idle compute, and a worker polling every 30–60 s keeps it awake around the clock and spends compute hours. Poll slowly (minutes) outside the hours a person is likely to queue work, or wake the worker on enqueue some other way, and check the Neon plan's compute allowance first.

### Phase 67+ — Horizon 3: Infrastructure Agent
- [ ] `agent_resources` ledger table (owner, provider, kind, environment, est. cost, `ephemeral`, `ttlAt`, destroy procedure, lifecycle state) + `.infrastructure/resources.json` mirror
- [ ] Dev-only provisioning in order: GitHub repo → Vercel preview → Neon/Supabase dev branch → Cloudflare preview DNS → AWS/GCP
- [ ] IaC-first (Terraform / provider-native), plan → review → apply-to-dev → commit
- [ ] Disposable environments with "destroy what you created" exception; TTL sweeper proposes teardown of everything else
- [ ] Mission mode (PRD §21.19): starts in `awaiting_approval` with cost estimate; unlocked only after Tier 1–3 accuracy gates

---

## Distribution Roadmap

> **Deferred (2026-10-07).** RepoHQ is a personal tool for now (audit §9.2): sign-in is limited to the owner, and the pricing page and subscription webhook are removed. These phases stay here for if it becomes a product.

Features required to open RepoHQ to other users. Tracked separately because they each touch auth, data isolation, billing, or GitHub platform constraints.

### D1 — GitHub App (real-time webhooks + PR merge detection)
- Replace polling-based PR merge detection with real-time `pull_request` webhooks
- GitHub App installation flow per user (separate from OAuth App)
- Handles: PR merge events, push events for instant sync, security alerts
- Required for: sub-minute merge detection, multi-user scale (each user installs the app)
- **Blocker for open distribution**: OAuth App token approach doesn't scale; GitHub App is the right model for SaaS

### D2 — Multi-tenant data isolation
- Row-level security audit: every query scoped to `userId`; automated check in CI
- Rate limiting per user on AI endpoints and sync crons
- Webhook secret scoped per user (currently global env var)
- Admin dashboard: user list, sync status, error rates

### D3 — Self-serve onboarding
- OAuth sign-up flow (already exists via Auth.js) → automated first sync → guided setup
- Empty-state walk-through (no repos → sync button → first health score)
- Email welcome + sync completion notification

### D4 — Billing
- Stripe subscription gate for AI features (advisor, MCP, BYOK settings)
- Free tier: sync + health scores only; Paid: AI advisor, agent execution, BYOK
- Usage metering for agent execution costs

### D5 — BYOK for agent execution
- Let each user run the factory worker on their own machine against their own requests
- Today the factory serves one owner (`FACTORY_USER_ID`) and one queue; needs per-user queues (or a `userId` filter in the worker) and per-user allowlists in settings

---

## Deferred

| Feature | Reason |
|---------|--------|
| Vercel deployment history (logs, preview URLs) | Needs `VERCEL_TOKEN` billing scope |
| Netlify / Render / Railway API integrations | Needs per-platform tokens |
| Anthropic / OpenAI / AWS cost tracking | No per-project tracking in those APIs |
| GitHub Webhook real-time sync | Requires GitHub App (separate from OAuth App) |
| Incremental sync | Nice-to-have for portfolios > 200 repos |
| Phase 16 trend lines | Accumulating automatically — will ship after ~30 daily syncs |
| Slack / email digest delivery | Pipe Monday digest to Slack or email so it's seen without logging in |
| Founder Memory Layer | Vector DB + retrieval pipeline — high complexity, years to pay off |
| Codebase Cross-Pollinator | pgvector embeddings across repos — interesting but high noise-to-signal |
| Burnout Predictor | Insufficient data for one person's commit history |
| Auto PR Generation | Requires GitHub App (separate OAuth flow) |
| Weekly CEO Conversation Mode | Interesting but requires real-time chat UI infrastructure |
| Job Market / Tech Demand Scoring | Interesting career-angle feature; low priority for pure portfolio management |

---

## Infrastructure

**GitHub Actions (canonical trigger — `.github/workflows/cron-*.yml`):**

| Workflow | Schedule | Endpoint |
|----------|---------|---------|
| cron-sync | every 6h | `/api/cron/sync` |
| cron-security | 03:00 daily | `/api/cron/security` |
| cron-deployments | every 12h | `/api/cron/deployments` |
| cron-ai-summary | 05:00 Sunday | `/api/cron/ai-summary` (enqueue per-repo jobs then process loop) |
| cron-digest | 06:00 Monday | `/api/cron/digest` |

GitHub disables these after 60 days without a commit (it happened Aug 14 – Oct 6, 2026). The app shows a stale-data banner and the morning report flags disabled workflows; re-enable with `gh workflow enable <file> --repo smithdavedesign/Github-HQ`.

**Vercel cron:** none. `gstack-self` (daily /health + /qa-only self-scan via Nexus) was removed in the 2026-10 audit: it had targeted a deleted repo and failed every day since June; the factory covers RepoHQ itself.

All routes require `Authorization: Bearer $CRON_SECRET`.
