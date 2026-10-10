# RepoHQ Factory

The local self-improvement loop from [docs/autonomous-factory.md](../docs/autonomous-factory.md). It runs on this Mac against the local AI stack (`~/ai-stack`: Ollama → LiteLLM; documented in [docs/ai-stack](../docs/ai-stack/README.md)), finds verifiable problems in allowlisted repos, fixes them with the cheapest model that has proven it can, and opens **draft** PRs. Merging is always yours, and each merge or close teaches the router.

It is also RepoHQ's only agent executor (roadmap Phase 81, [PRD](../docs/agent-hq-migration-prd.md)): "Run agent", the skill launcher, Monday auto-dispatch and the MCP `queue_gstack_skill` tool all become requests the worker runs (see "Worker").

```
Sense    every allowlisted repo: red CI on the base branch, Dependabot alerts, stale bot PRs (gh, host)
         → one ranked queue → clone (host) → install → the repo's own typecheck / lint / test + README (sandbox)
Decide   tasks: red-ci · fix-types · lint-autofix · fix-lint · fix-tests · deps-audit · docs-readme
         gated by each capability's stage: observe → report → pr (see "Promotion ladder")
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
         lib/verify.ts judge (Judge v2 rules in lib/judge-rules.ts, then an advisory adversarial review): target check passes, nothing regresses, no check-silencing,
         no forbidden paths, size cap; README edits additive with real scripts/tools only
Gate     draft PR on a feature/bot/factory-… branch against the default branch (or
         `integrationBranch` if a repo still has one); you merge
Review   GitHub Copilot code review requested on every PR (independent Reviewer, ≤ 8/day).
         When Copilot can't (premium requests spent, review off, daily limit): the local AI
         stack reviews the diff with gstack's /review checklist and comments on the PR
         (lib/local-review.ts; reviewer = a different model family from the builder)
Learn    PR merged → success, closed → failure → ledger → router (per difficulty) → agent_jobs → KPIs
Report   06:45 email: one update per gstack role (PM → Architect plan, Builder, QA, Reviewer,
         Security, Ops, Retro), built from the ledger; headlines by the local model
```

## Commands

```bash
npm run factory -- --dry-run            # one cycle, no push/PR
npm run factory -- --repo=owner/name    # one repo (must be allowlisted)
npm run factory                         # real cycle: may open one draft PR
npm run factory -- --request=<id>       # run one Agent HQ request (what the worker does for a request job)
npm run factory:worker                  # the BullMQ worker in the foreground (REDIS_URL + FACTORY_USER_ID set)
npm run factory:report                  # per-tier attempts / verified / merged / cost
npm run factory:scout                   # re-evaluate free models, update LiteLLM aliases
npm run factory:e2e                     # end-to-end check against a local fixture repo (sandboxed)
FACTORY_SANDBOX=off npm run factory:e2e # the same on the host (trusted fixture only)
npm run factory:sandbox:check           # live isolation checks: no host env/creds/mounts, egress allowlist, cleanup
npm run factory:sandbox:build           # build the sandbox images (install-launchd.sh does this too)
npm run factory:judge-fixture -- <attemptId> --expect=reject --source="PR #12 closed: …"   # wrong verdict → regression fixture
npm run factory:migrate                 # apply factory/sql/*.sql to the RepoHQ DB (agent_jobs, idea_signals; idempotent)
npm run factory:smoke -- <pr-url> [--paths /,/x] [--comment]   # preview smoke by hand (skill: preview-smoke)
npm run context -- build | search "<q>" | interests | overview   # the context index (factory/context)
npm run factory:backfill-jobs           # copy ledger history into agent_jobs (needs ~/.repohq-factory/env sourced)
npm run factory:morning -- --no-send   # build the morning report and print it
bash factory/bin/setup-email.sh you@gmail.com   # one-time: Gmail app password → keychain, test email
bash factory/bin/install-launchd.sh     # with REDIS_URL: the always-on worker; without: the calendar (cycles hourly 20:00–06:00 + 12:00/16:00 on AC, report 06:45, scout Sun 17:10)
bash factory/bin/install-launchd.sh --uninstall
touch ~/.repohq-factory/PAUSE           # kill switch (rm to resume)
```

## Configuration

- `factory/factory.config.json`: `copilot.{enabled, model, maxTasksPerDay, review, maxReviewsPerDay, localFallback}` and `maxPrsPerDay` (default 8). Copilot tasks and reviews spend your seat's premium requests (× the model's multiplier); `gpt-5-mini` is an included model on paid plans, so set a stronger `copilot.model` only if your allowance covers it.
- `factory/factory.config.json`: `integrationBranch` (default `integration/agent`): used only by repos that still have that branch; everything else, including RepoHQ and Nexus since 2026-10, gets PRs against the default branch.
- Ledger hygiene: if a verdict turns out to be a judge bug, set `"voided": "<why>"` on that attempt in `~/.repohq-factory/ledger.jsonl`. It stays for history but stops counting for routing, dead ends and stats.
- `factory/factory.config.json`: the **allowlist** (`repos`). The factory never touches a repo that isn't listed. Also `allowFreeCloud` (private repos allowed on M1), `monthlyBudgetUsd` (M2; default 0, which means never pay) and `maxPrsPerCycle`.
- `factory/factory.config.json`: `schedules` (cron patterns for the worker's `cycle`, `report` and `scout` jobs, in this Mac's timezone; defaults match the old calendar). Remove a key to stop that job.
- `~/.repohq-factory/env`: runtime settings sourced by the launchd wrapper. `FACTORY_USER_ID` mirrors attempts into RepoHQ (`portfolio_events`, `agent_jobs`) and is required for Agent HQ requests, runs and traces. The DB URL is read from RepoHQ's own `.env.local` at runtime, not copied. Set `FACTORY_OP_ENV_FILE` to resolve secrets through 1Password (`op run`).
- State lives in `~/.repohq-factory/`: `ledger.jsonl` (source of truth), `logs/<run>/` (prompts + harness output per attempt), `scout-reports/`.

## Worker

Since Phase 81 the factory runs as one long-lived BullMQ worker (`factory/worker.ts`) instead of a launchd calendar. RepoHQ never runs agents: it writes an `agent_requests` row in Neon and adds a job to the `factory` queue on Redis (`render.yaml`, the `agent-hq-redis` Key Value). The worker takes one job at a time:

| Job | From | Runs |
|---|---|---|
| `request` (priority 1) | RepoHQ "Run agent" / skill launcher / auto-dispatch / MCP | `run.ts --request=<id>`: that repo's owner task only. Fix skills (`/ship`, `/qa`, `/document-release`) go through the usual ladder and judge; report skills (`/investigate`, `/review`, `/qa-only`, `/health`, `/retro`) are a read-only investigation whose findings land in RepoHQ |
| `cycle` | scheduler | `run.ts --scheduled`, as before |
| `report` | scheduler | the morning report, then prunes runs older than 90 days |
| `scout` | scheduler | the weekly model scout |

Before each job it checks the gates: `PAUSE` file (wait 15 min), the run lock (wait 5 min), AC power and Docker (a cycle is skipped; a request waits 15 min). A request that hits an environment problem (LiteLLM down, PR cap reached) is **deferred**: back to `queued` with the reason, and retried later. Only its own failures count, and the third one fails it. Nothing is ever re-routed to a paid model.

Every job runs in a fresh child process under `caffeinate -ims` (its log is `~/.repohq-factory/logs/<job>-<time>-<id>.log`). The child prints `::trace::` lines that become `trace_events` rows and live BullMQ progress, and one `::result::` line that decides the request's fate. Every job is an `automation_runs` row. RepoHQ's **Agents** page (`/agent-performance`) shows all of it: the worker's status, queue counts, schedules, recent runs, requests and each one's step trace, with owner-only Run now, Pause/Resume, Cancel and Retry.

The worker refreshes a status record in Redis every 30 s (kept for a week, so the page knows when it was last seen). The page tells four cases apart (`factory/lib/worker-state.ts`):

| Says | Means | Do |
|---|---|---|
| **online** | Running and able to work. PAUSE and battery show as flags | — |
| **not working** — why | Running but blocked: Docker is down, requests can't run (FACTORY_USER_ID missing), or launchd keeps restarting it (3+ starts in 15 min) | Fix what it says; `~/.repohq-factory/logs/launchd-worker.err` |
| **off** | Silent for 3+ min (the Mac is asleep, shut down or offline), or stopped cleanly (shutdown, reinstall) | Nothing: requests wait |
| **not set up** | No status ever written | `bash factory/bin/install-launchd.sh` |

It heals itself (`factory/lib/worker-health.ts`). Each status write has a 10 s timeout. A failed write reconnects. After five failures in a row, an idle worker exits for launchd to restart it. So does a worker whose queue has had jobs waiting for 10 minutes with nothing running. This is because Render's Key Value proxy has dropped a quiet connection without closing it: commands on it then waited forever, and the page called a working worker offline (2026-10-07).

Neon is the source of truth and Redis only wakes the worker: on start and after every cycle it re-adds a job for any open request whose job is missing, so a lost Redis or a failed enqueue costs a delay, not a request. OpenClaw's `queue/owner-requests.jsonl` still works; those requests are mirrored into the same table.

Setup (once): create the Key Value from `render.yaml` (Render → Blueprints), put its external URL in RepoHQ's `.env.local` as `REDIS_URL` (and in Vercel with `FACTORY_USER_ID`), run `npm run db:push` and `npm run factory:migrate`, then `bash factory/bin/install-launchd.sh`. It stores the URL in the login keychain (`repohq-factory-redis-url`) and installs `com.repohq.factory.worker` (KeepAlive) in place of the calendar. Local development: `docker compose up -d redis` and `REDIS_URL=redis://127.0.0.1:6379`.

**The factory's GitHub identity: the `repohq-factory` GitHub App** (roadmap Phase 66, `factory/lib/github-app.ts`). When `FACTORY_GH_APP_CLIENT_ID` is set in `~/.repohq-factory/env` and the private key is at `~/.repohq-factory/github-app.pem` (mode 600), every host-side `gh` and `git` call runs with a short-lived installation token, minted again 10 minutes before it expires. Branches, PRs, labels and comments then belong to `repohq-factory[bot]`, and commits are authored by it. That's what lets you approve factory PRs, so `main` can require a review (an author can't approve their own PR).
- Permissions: Contents and Pull requests read & write; Issues read & write (labels); Checks, Actions and Dependabot alerts read. **No Workflows access**, so GitHub itself refuses a factory push that edits `.github/workflows`. Install it on the allowlisted repos only.
- Calls that must stay on your login pass `GH_TOKEN: ''`: Copilot (CLI, quota, review requests), `gh api user`, and the morning email's search across every repo you own.
- If minting fails (network, revoked key), the call logs one warning and falls back to your `gh` login, so the night shift keeps running.
- Without the app, the older option still works: a fine-grained token in the keychain as `repohq-factory-gh-token`, which `factory.sh` exports as `GH_TOKEN` ([agent-hq-tradeoffs.md](../docs/agent-hq-tradeoffs.md) recommendation 9). It's still your identity, though.

Promotion still applies: requests use the `owner-requested` (fix) and `owner-report` (report) capabilities. `owner-requested` starts at `report`, so a fix request ends `verified` (judged, held, no PR) until you promote it to `pr`.

What holds a request back. Each of these ends it `rejected`, with the reason:
- An `owner-requested` PR already open on the repo.
- Stale bot PRs on the repo, when the request would open a PR (below).
- A dead end: that request failed twice already. Dead ends count per request, so one request's failures don't block the next on the same repo.
- The judge, not the queue: a fix request can't add or edit tests. Only `fix-tests` tasks may touch test files (`verify.ts`, an anti-gaming rule), so asking for tests ends `failed` with "edited tests for a owner-requested task".

RepoHQ itself refuses a new request while the repo has one open, or an agent PR that isn't merged or closed yet, CI failing or not.

If no cycle or request finishes for 36 h, RepoHQ shows a banner and the morning report raises it. Skipped runs (Docker down, on battery, LiteLLM down) and the daily report don't count. The message gives the last skip reason.

Compared with Nexus's always-on Render worker, this setup trades availability and model quality for one governed, sandboxed, $0 path. Requests wait for this Mac, they never escalate to paid models (they run under the $0 unattended policy), and the Mac's upkeep is now yours. The full assessment and what to do about each cost: [docs/agent-hq-tradeoffs.md](../docs/agent-hq-tradeoffs.md).

Tests: `npm run test:flow` runs this worker end to end against a throwaway Postgres + Redis (`docker compose --profile flow up -d`), with `FACTORY_WORKER_CHILD` pointing it at a scripted stand-in for run.ts; see [tests/flow](../tests/flow/README.md). Never set `FACTORY_WORKER_CHILD` on the real worker.

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

## Tier advisor

A local model (`advisor.model`, default `local-qwen3`) rates every task 1–3 before routing (`lib/tier-advisor.ts`). It runs locally, so it may read private and work code.

| Difficulty | Means | Starts at |
|---|---|---|
| 1 routine | lint, dependency bumps, docs, a one-file mechanical fix | M0 local |
| 2 moderate | bugs, failing tests, type errors, a small feature | M1 free pool |
| 3 advanced | features across files, PRD milestones, architecture | MC Copilot, else M2 (Claude for idea builds) |

- **Capability `tier-advisor`, starting at `report`:**
  - every rating is logged (`tier_advice` in the ledger) next to what the router chose;
  - it's scored against the lowest tier that actually produced a verified fix in that run: exact, too high or too low;
  - the morning report's ladder shows the score and says when to promote (≥ 10 judged, ≥ 80% exact or too high, ≥ 50% exact).
- **At `pr`**, routing starts at the advised tier, within what the task is allowed (private repos still never get free cloud).
- **Fallback is never the advisor's call.** Escalation on failure and capacity fallbacks stay deterministic.
- If the model doesn't answer, each task kind's usual difficulty is used.
- By hand, or from idea-factory: `npm run factory:rate -- --kind <kind> --title "…" --objective "…"`. First live ratings: a lint fix 1, CSV export 2, accounts + scheduler + billing 3, in 2–7 s each.

## Verification that runs the code

The judge's checks (typecheck, lint, tests) don't run the app. Two checks added on 2026-10-10 do:

- **Build on every code change.** When the repo has a `build` script, the base build runs once per repo per cycle. A change that makes a passing build fail is a regression. README-only and report-stage work is exempt (`judgesBuild`), and a base that doesn't build gates nothing.
- **Preview smoke** (`lib/smoke.ts`). In reconcile, each open factory PR's Vercel preview is loaded in headless Chromium next to production:
  - public paths only, from `smoke.paths` in `factory.config.json` (default `/`);
  - each side is loaded twice;
  - it fails on a status or crash regression, or an error that shows on every preview load and no production load;
  - third-party noise is ignored.

  The result is a PR comment, a `smoke:fail` label on failure, and a line in the morning report's QA section. Vercel protection is passed with each project's automation-bypass secret (created once, cached in `~/.repohq-factory/vercel-bypass.json`).

## Judge v2

Rules run before anything model-based, and each exists because a weak model can turn a check green without fixing anything (`lib/judge-rules.ts`):

| Rule | Rejects |
|---|---|
| Test integrity | snapshot rewrites; a touched test file losing assertions; `vi.mock`/`jest.mock` of the project's own modules |
| Type escapes | new `as any` / `: any` in source files for type and lint fixes |
| Diff sanity | deleted source files; removed exports; unscoped fixes touching > 3 files beyond the ones their errors named; the model reformatting code it didn't need to touch |
| Imports | new bare imports that aren't declared dependencies or Node builtins; relative imports of files that don't exist |
| Coverage | a drop of more than 0.5 points, where the test script already prints coverage |

Then the **adversarial reviewer** (`lib/adversary.ts`): a model from a different family than the builder (M0 → `free-agent`; M1/MC/M2 → `local-qwen3`, configurable under `judge.adversarial` in `factory.config.json`) tries to argue the PR should not merge. Every issue must quote the diff, or it's dropped. It can never approve: PASS does nothing; UNCERTAIN or FAIL adds the `needs-careful-review` label and an "Adversarial review" section to the PR; FAIL rejects only after you promote `adversarial-veto` to `pr`. If it errors or times out, nothing happens.

**Regression suite.** `factory/judge-fixtures/*.json` are verdicts the judge once got wrong or rules it must keep; `tests/unit/judge-regression.test.ts` replays them. Every attempt now saves its judge inputs (`logs/<run>/<repo>-<kind>-<tier>.judge.json`), so when you close a PR the judge passed (or void a verdict it got wrong), run `npm run factory:judge-fixture -- <attemptId> --expect=reject|accept --source="…"`. The new fixture fails until the judge is fixed.

## Promotion ladder

Each capability has a stage under `capabilities` in `factory.config.json`:

| Stage | Means |
|---|---|
| `observe` | Sensed and logged only |
| `report` | Runs and is judged; no PR. Results appear in the morning report ("Held back"; red-CI root causes under Ops) |
| `pr` | Opens draft PRs (for `adversarial-veto`: a FAIL rejects instead of only labelling) |

Defaults: the six proven task kinds at `pr`; `red-ci`, `security-alerts`, `adversarial-veto` at `report`. The morning report's **Director** section shows each capability's evidence and says when one has earned promotion (e.g. 5 verified at ≥ 80%) or should drop back (you close most of its PRs). Only you change stages.

## Sensors and the queue

At the start of each cycle the factory senses every allowlisted repo with read-only `gh` calls: the latest run of each workflow on the base branch (red CI), Dependabot alerts, and bot PRs. It then ranks repos (`rankOpportunities`): red CI > security > npm audit > failing checks > never scanned > docs, raised for low RepoHQ health scores, with clean repos coming round again as their last scan ages.

- **Red CI** becomes a `red-ci` task. At `report` it's a sandboxed root-cause investigation on the free pool. At `pr` it's a fix whose oracle is the failing workflow passing on the PR.
- **Dependabot alerts** are reported (enable them per repo under Settings → Code security; all 9 repos had them off on 2026-10-06). Fixes go through `deps-audit`.
- **Stale bot PRs** (autonomous branch, open 7+ days, nobody reviewed) are listed, and **that repo gets no new factory PRs until you review or close them** (`blockOnStaleBotPrs: false` turns this off). That covers requests too. A fix request that would open a PR is rejected with the reason. Report requests, and fixes held at stage `report`, still run.

## KPIs and the job record

Every attempt is a row in RepoHQ's `agent_jobs` table (parent job for escalations, the Agent HQ request it served, requests, reviewer, isolation, outcome, the commits you added). The Agents page (`/agent-performance`) and the morning report show the KPIs (`src/lib/agents/factory-kpis.ts`):

| KPI | Definition |
|---|---|
| Overnight yield | merged PRs ÷ nights the factory ran (the number the project optimises) |
| Acceptance | merged ÷ (merged + closed) |
| Per 100 free requests | merged PRs per 100 free-cloud requests (M1 turns + `free-agent` reviews) |
| Review time | median hours from PR to your decision; PRs you had to edit |
| Autonomy | merged without your edits ÷ (every resolved PR + every approval request) |
| PR value | 0–5 per merged PR, scored from its outcome on main (a `value:N` label overrides); useful = value ≥ 2; useful PRs per night |

**PR value, scored from outcomes** (`factory/lib/outcomes.ts`, since 2026-10-08). Merged isn't the same as useful, and nobody rates PRs by hand, so a day after a factory PR merges, reconcile scores it from what changed on `main`, using only what the factory already records:

| Score | Evidence |
|---|---|
| 3 | critical npm advisories dropped (`deps-audit`), or the red workflow is green on main (`red-ci`) |
| 2 | high advisories dropped; the check it fixed passes on main (`fix-tests`, `fix-types`, `fix-lint`); an owner request merged |
| 1 | upkeep (`docs-readme`, `lint-autofix`), or no evidence after 14 days |
| 0 | the check still fails on main, or the advisories didn't drop |

The score lands in the ledger (`value` entry, `source: "outcome"`, with the evidence) and `agent_jobs.value`. A `value:0`–`value:5` label on the PR overrides it at any time within 30 days of the merge; reconcile creates the labels in each repo (marker files in `~/.repohq-factory/value-labels/`).

Routing learns per difficulty (simple: docs/lint-autofix/deps; medium: lint/types; hard: tests/red CI), so evidence accumulates three times faster than per task kind.

## Night shift

Scheduled cycles (the worker's `cycle` scheduler, or the launchd calendar without a `REDIS_URL` → `run.ts --scheduled`) run hourly 20:00–06:00 plus 12:00 and 16:00, and:
- are **skipped on battery** (`FACTORY_REQUIRE_AC=0` overrides): on battery the Mac sleeps mid-cycle;
- **refuse to run with the sandbox off**;
- **always run at $0**, even if `monthlyBudgetUsd` allows paid work for manual runs.

The Night Shift v2 gate has two halves, and `npm run factory:report` and the morning report show both:
- **Sandbox:** 7 consecutive nights with every attempt sandboxed.
- **Quality** (since 2026-10-07): over the last 30 days, ≥ 5 merged or closed PRs with ≥ 50% merged, and ≥ 3 scored PRs of which ≥ 50% were useful (value ≥ 2). Clean nights prove the sandbox, not that the PRs are worth having.

After that, success is the 30-night trend in yield, acceptance and useful PRs per night, not PR count.

The morning email opens with **your review queue** (every open PR across the allowlist owners' repos, oldest first, 7+ days flagged; Dependabot and your own PRs too, not just the factory's) and **what to do next** (RepoHQ's decision states, `src/lib/portfolio/next-actions.ts`). The second needs the RepoHQ sink (`FACTORY_USER_ID`), which the worker loads from `~/.repohq-factory/env`.

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

Since Phase 80, scheduled cycles check this themselves: on battery they log "skipped — on battery power" and exit. Missed slots run once on wake (BullMQ keeps one pending job per scheduler, as launchd coalesced its slots), pushes and PR creation retry on network errors, and the Ops section of the morning report shows how many cycles actually ran.
