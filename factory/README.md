# RepoHQ Factory

The local self-improvement loop from [docs/autonomous-factory.md](../docs/autonomous-factory.md). It runs on this Mac against the local AI stack (`~/ai-stack`: Ollama → LiteLLM), finds verifiable problems in allowlisted repos, fixes them with the cheapest model that has proven it can, and opens **draft** PRs. Merging is always yours, and each merge or close teaches the router.

```
Sense    clone (host) → install → the repo's own typecheck / lint / test + README check (sandbox)
Decide   tasks: fix-types · lint-autofix · fix-lint · fix-tests · deps-audit · docs-readme (Tier 1–2 only)
Route    src/lib/agents/model-router.ts: cheapest proven tier, data-class gate, ~10% exploration
Execute  in the Docker sandbox (no credentials, allowlisted egress; see "Sandbox" below)
         M0 Aider → local-agent (Qwen2.5-Coder 7B)   $0
         M1 Claude Code --bare → free-agent pool: Ollama Cloud · OpenRouter · Gemini   $0
            (picked by the scout; a 429 on one provider falls through to the next)
         MC GitHub Copilot CLI (your seat, gpt-5-mini by default)   prepaid, ≤ 6 tasks/day
            (host-only: needs your GitHub login, so it is skipped while the sandbox is on)
         M2 Claude Code --bare → cloud-smart (Anthropic)   only with a budget > 0
         deps-audit runs `npm audit fix` (no model, never --force); lint-autofix runs the
         repo's own fixer (eslint --fix / prettier --write) as a mechanical PR
Verify   (host) the sandbox's result comes back as a patch, applied to the host clone; then the
         lib/verify.ts judge: target check passes, nothing regresses, no check-silencing,
         no forbidden paths, size cap; README edits additive with real scripts/tools only
Gate     draft PR on a feature/bot/factory-… branch, targeting integration/agent when the repo
         has it (else the default branch); never merges; ≤ 1 per cycle, ≤ 8 per factory day
Review   GitHub Copilot code review requested on every PR (independent Reviewer, ≤ 8/day;
         paused while the seat's premium requests are spent)
Learn    PR merged → success, closed → failure → ledger → router
Report   06:45 email: one update per gstack role (PM → Architect plan, Builder, QA, Reviewer,
         Security, Ops, Retro), built from the ledger; headlines by the local model
```

## Commands

```bash
npm run factory -- --dry-run            # one cycle, no push/PR
npm run factory -- --repo=owner/name    # one repo (must be allowlisted)
npm run factory                         # real cycle: may open one draft PR
npm run factory:report                  # per-tier attempts / verified / merged / cost
npm run factory:scout                   # re-evaluate free models, update LiteLLM aliases
npm run factory:e2e                     # end-to-end check against a local fixture repo (sandboxed)
FACTORY_SANDBOX=off npm run factory:e2e # the same on the host (trusted fixture only)
npm run factory:sandbox:check           # live isolation checks: no host env/creds/mounts, egress allowlist, cleanup
npm run factory:sandbox:build           # build the sandbox images (install-launchd.sh does this too)
npm run factory:morning -- --no-send   # build the morning report and print it
bash factory/bin/setup-email.sh you@gmail.com   # one-time: Gmail app password → keychain, test email
bash factory/bin/install-launchd.sh     # schedule: cycles hourly 20:00–05:00 + 12:00/16:00, report 06:45, scout Sun 17:10
bash factory/bin/install-launchd.sh --uninstall
touch ~/.repohq-factory/PAUSE           # kill switch (rm to resume)
```

## Configuration

- `factory/factory.config.json`: `copilot.{enabled, model, maxTasksPerDay, review, maxReviewsPerDay}` and `maxPrsPerDay` (default 8). Copilot tasks and reviews spend your seat's premium requests (× the model's multiplier); `gpt-5-mini` is an included model on paid plans, so set a stronger `copilot.model` only if your allowance covers it.
- `factory/factory.config.json`: `integrationBranch` (default `integration/agent`): repos that have it get their PRs there, per the release policy (agent work → `integration/agent` → human-labelled release → `main`).
- Ledger hygiene: if a verdict turns out to be a judge bug, set `"voided": "<why>"` on that attempt in `~/.repohq-factory/ledger.jsonl`. It stays for history but stops counting for routing, dead ends and stats.
- `factory/factory.config.json`: the **allowlist** (`repos`). The factory never touches a repo that isn't listed. Also `allowFreeCloud` (private repos allowed on M1), `monthlyBudgetUsd` (M2; default 0, which means never pay) and `maxPrsPerCycle`.
- `~/.repohq-factory/env`: runtime settings sourced by the launchd wrapper. `FACTORY_USER_ID` mirrors attempts into RepoHQ (`portfolio_events`). The DB URL is read from RepoHQ's own `.env.local` at runtime, not copied. Set `FACTORY_OP_ENV_FILE` to resolve secrets through 1Password (`op run`).
- State lives in `~/.repohq-factory/`: `ledger.jsonl` (source of truth), `logs/<run>/` (prompts + harness output per attempt), `scout-reports/`.

## Sandbox

Since Phase 76 (docs/autonomous-factory.md §14), nothing from a target repo runs on this Mac. `npm ci`, the repo's checks and the model harness run in a throwaway Docker container per repo; the host only clones, judges, commits and pushes.

```
host ──clone (gh auth)──▶ tar stream ──▶ worker container ──internal network──▶ egress container ──▶ registries, LiteLLM
host ◀──────────────── patch (file contents only) ◀── worker          (nothing else leaves the worker)
```

| Property | How |
|---|---|
| No credentials | No GitHub token, no `gh`, no `~/.ssh` / `~/.aws` / keychain; the worker gets only the per-command env the factory passes (never the host's environment, so `FACTORY_DATABASE_URL` etc. stay out) |
| No host access | No bind mounts, no Docker socket; the clone is streamed in with `tar` and owned by a non-root `worker` user |
| Least privilege | `--cap-drop ALL`, `no-new-privileges`, `--cpus 4`, `--memory 4g` (no extra swap), `--pids-limit 1024` |
| Egress allowlist | The worker is on an `--internal` network with no route out. Its only peer, the egress container, proxies `sandbox.allowHosts` (default `registry.npmjs.org`, `registry.yarnpkg.com`) and refuses every other host |
| Free models only | Model calls go to the egress relay, which forwards only the factory's aliases (`local-agent`, `free-agent`, `local-small`; the paid alias only when `monthlyBudgetUsd > 0`). The LiteLLM key is a known constant, so this is what stops repo code from spending on `cloud-smart` |
| Time limits | Every command runs under `timeout` inside the container; the container's PID 1 is a 90-minute `sleep`, so it exits on its own even if the factory dies |
| Cleanup | Containers and the network are removed after each repo; leftovers from a crashed run are swept at the next cycle start (label `repohq.factory.sandbox`) |
| No fallback to the host | If Docker isn't running, the cycle is **skipped** (logged), never run on the host |

Configure under `sandbox` in `factory/factory.config.json`: `mode` (`docker` | `off`), `cpus`, `memory`, `pidsLimit`, `lifetimeMs`, `allowHosts`. `FACTORY_SANDBOX=off` is for trusted fixtures (the e2e check), not for real repos.

Images (`factory/docker/`): `worker.Dockerfile` (Node 22, git, Aider, Claude Code, pnpm; ~1.8 GB) and `egress.Dockerfile` (tinyproxy + the model relay; ~235 MB). Tags are a hash of the Dockerfiles, so an edit rebuilds them on the next cycle and older tags are removed. `install-launchd.sh` prebuilds them.

Known limits:
- **Disk** isn't capped per container (Docker Desktop's overlay2 doesn't support `--storage-opt size`); the container's writable layer is deleted after each repo, and the Docker VM disk is the ceiling.
- **Copilot (MC)** needs your GitHub login, so it doesn't run in the sandbox; while the sandbox is on, routing skips MC (Copilot *review* of PRs still runs, on the host, against GitHub).
- Installs that download binaries from other hosts (e.g. Playwright browsers, some native modules from GitHub releases) fail inside the sandbox; the repo is then skipped as `install failed`. Add the host to `allowHosts` only if you trust what it serves.
- Concurrency is 1: on a 16 GB Mac, Docker's VM has 8 GB and Ollama keeps a 7B model resident.

## Free-tier facts that shape the design

- **The free tier is a pool, not one provider** (docs/autonomous-factory.md §3.1). `free-agent → free-agent-b → free-agent-c` span Ollama Cloud's free plan, OpenRouter `:free` and Gemini's AI Studio free tier, so one provider's quota or outage doesn't stop the loop. `npm run factory:scout` re-picks them.
- **OpenRouter free quota is per account, ~50 requests/day at $0 credit.** One Claude Code task uses about 10–30 requests. The factory reads `GET /api/v1/key` before every M1 task. It **defers** only if the pool is OpenRouter-only and fewer than 25 requests remain, and it never escalates to paid because of quota. A one-time $10 OpenRouter credit raises the free-model limit to 1,000/day (per OpenRouter's docs). That's the cheapest way to scale M1.
- Shared free pools also throttle per model upstream (429 "rate-limited upstream"). The scout skips throttled models and accumulates evidence across runs (`scout-reports/`, 21-day window).
- M0 (7B, 16k context) is good for small scoped edits: one-file fixes run in seconds. It can't host Claude Code (the system prompt alone overflows 16k), whole-file rewrites truncate large files (so Aider runs with `--edit-format diff`), and files over 12KB are routed past M0.
- Repos whose `lint` script auto-fixes (`eslint --fix`) mutate the tree during checks. The factory discards that after the baseline scan and folds it into the judged diff after a fix, so what's judged is exactly what ships.
- The scout and the cycle share a lock: the scout restarts LiteLLM, which would drop an in-flight agent request.

## Overnight runs need power

The first scheduled night showed the Mac on battery dropping into Deep Idle sleep between steps: a 10-minute cycle took three hours and its push failed with the network down. `caffeinate -ims` keeps the system awake **only on AC power**. For 3–8 PRs by morning:

- leave the Mac **plugged in** overnight;
- System Settings → Battery → Options → turn on **"Prevent automatic sleeping on power adapter when the display is off"**;
- optional, so the first cycle runs even if the Mac slept: `sudo pmset repeat wakeorpoweron MTWRFSU 19:58:00`.

Missed launchd slots run once on wake (launchd coalesces them), pushes and PR creation retry on network errors, and the Ops section of the morning report shows how many cycles actually ran.
