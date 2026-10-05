# RepoHQ Factory

The local self-improvement loop from [docs/autonomous-factory.md](../docs/autonomous-factory.md). It runs on this Mac against the local AI stack (`~/ai-stack`: Ollama → LiteLLM), finds verifiable problems in allowlisted repos, fixes them with the cheapest model that has proven it can, and opens **draft** PRs. Merging is always yours, and each merge or close teaches the router.

```
Sense    clone → install → the repo's own typecheck / lint / test + README check
Decide   tasks: fix-types · fix-lint · fix-tests · docs-readme (Tier 1–2 only)
Route    src/lib/agents/model-router.ts: cheapest proven tier, data-class gate, ~10% exploration
Execute  M0 Aider → local-agent (Qwen2.5-Coder 7B)   $0
         M1 Claude Code --bare → free-agent (OpenRouter free, picked by the scout)   $0
         M2 Claude Code --bare → cloud-smart (Anthropic)   only with a budget > 0
Verify   lib/verify.ts judge: target check passes, nothing regresses, no check-silencing,
         no forbidden paths, size cap; README edits additive with real scripts/tools only
Gate     draft PR (never merges), at most 1 per cycle
Learn    PR merged → success, closed → failure → ledger → router
```

## Commands

```bash
npm run factory -- --dry-run            # one cycle, no push/PR
npm run factory -- --repo=owner/name    # one repo (must be allowlisted)
npm run factory                         # real cycle: may open one draft PR
npm run factory:report                  # per-tier attempts / verified / merged / cost
npm run factory:scout                   # re-evaluate free models, update LiteLLM aliases
bash factory/eval/e2e.sh                # end-to-end check against a local fixture repo
bash factory/bin/install-launchd.sh     # schedule: cycles 18:00 + 03:00, scout Sun 17:10
bash factory/bin/install-launchd.sh --uninstall
touch ~/.repohq-factory/PAUSE           # kill switch (rm to resume)
```

## Configuration

- `factory/factory.config.json`: the **allowlist** (`repos`). The factory never touches a repo that isn't listed. Also `allowFreeCloud` (private repos allowed on M1), `monthlyBudgetUsd` (M2; default 0, which means never pay) and `maxPrsPerCycle`.
- `~/.repohq-factory/env`: runtime settings sourced by the launchd wrapper. `FACTORY_USER_ID` mirrors attempts into RepoHQ (`portfolio_events`). The DB URL is read from RepoHQ's own `.env.local` at runtime, not copied. Set `FACTORY_OP_ENV_FILE` to resolve secrets through 1Password (`op run`).
- State lives in `~/.repohq-factory/`: `ledger.jsonl` (source of truth), `logs/<run>/` (prompts + harness output per attempt), `scout-reports/`.

## Free-tier facts that shape the design

- **OpenRouter free quota is per account, ~50 requests/day at $0 credit.** One Claude Code task uses about 10–30 requests. The factory checks `GET /api/v1/key` before every M1 task and **defers** when fewer than 25 remain; it never escalates to paid because of quota. A one-time $10 OpenRouter credit raises the free-model limit to 1,000/day (per OpenRouter's docs). That's the cheapest way to scale M1.
- Shared free pools also throttle per model upstream (429 "rate-limited upstream"). The scout skips throttled models and accumulates evidence across runs (`scout-reports/`, 21-day window).
- M0 (7B, 16k context) is good for small scoped edits: one-file fixes run in seconds. It can't host Claude Code (the system prompt alone overflows 16k), whole-file rewrites truncate large files (so Aider runs with `--edit-format diff`), and files over 12KB are routed past M0.
- Repos whose `lint` script auto-fixes (`eslint --fix`) mutate the tree during checks. The factory discards that after the baseline scan and folds it into the judged diff after a fix, so what's judged is exactly what ships.
- The scout and the cycle share a lock: the scout restarts LiteLLM, which would drop an in-flight agent request.
