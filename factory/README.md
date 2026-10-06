# RepoHQ Factory

The local self-improvement loop from [docs/autonomous-factory.md](../docs/autonomous-factory.md). It runs on this Mac against the local AI stack (`~/ai-stack`: Ollama → LiteLLM), finds verifiable problems in allowlisted repos, fixes them with the cheapest model that has proven it can, and opens **draft** PRs. Merging is always yours, and each merge or close teaches the router.

```
Sense    clone → install → the repo's own typecheck / lint / test + README check
Decide   tasks: fix-types · lint-autofix · fix-lint · fix-tests · deps-audit · docs-readme (Tier 1–2 only)
Route    src/lib/agents/model-router.ts: cheapest proven tier, data-class gate, ~10% exploration
Execute  M0 Aider → local-agent (Qwen2.5-Coder 7B)   $0
         M1 Claude Code --bare → free-agent pool: Ollama Cloud · OpenRouter · Gemini   $0
            (picked by the scout; a 429 on one provider falls through to the next)
         MC GitHub Copilot CLI (your seat, gpt-5-mini by default)   prepaid, ≤ 6 tasks/day
         M2 Claude Code --bare → cloud-smart (Anthropic)   only with a budget > 0
         deps-audit runs `npm audit fix` (no model, never --force); lint-autofix runs the
         repo's own fixer (eslint --fix / prettier --write) as a mechanical PR
Verify   lib/verify.ts judge: target check passes, nothing regresses, no check-silencing,
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
bash factory/eval/e2e.sh                # end-to-end check against a local fixture repo
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
