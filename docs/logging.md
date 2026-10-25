# System logging

One log for every part of the system: RepoHQ, the factory, the idea pipeline, the local AI stack, OpenClaw, launchd jobs and GitHub Actions crons. Failures and recoveries reach Slack **#team-agents**.

**Why it exists:** every serious problem in the week of 2026-10-06 failed silently.
- The OpenClaw front door crashed every 15 minutes for four days.
- The Anthropic API credit ran out, and Claude calls quietly fell back.
- GitHub had switched off the cron workflows after 60 days.

Each of these is now a probe that alerts.

## How it works

```
any system ──append one JSON line──▶ ~/.system-events/events.jsonl ─┐
                                                                     ├─▶ collector (launchd, every 5 min) ──hourly──▶ Neon system_events (90 days)
probes: services, launchd, OpenClaw cron, GitHub crons, LiteLLM log ─┘            │
RepoHQ automation_runs (factory jobs, cron routes) ──────────────────────────────┤
                                                                                  ├─▶ Slack #team-agents: 🔴 failing · 🟠 still failing (6h) · 🟢 recovered
                                                                                  └─▶ morning email (Ops) · Agents page "System log"
```

- **The file is the source.** Writing to it works offline and from any language. Neon is the searchable index.
- **Neon hears from the collector once an hour** (`NEON_SHIP_MS`): the shipment, the `automation_runs` read and the RepoHQ `/api/health` probes (its health check queries Neon). Neon suspends after 5 idle minutes, and touching it every 5 minutes kept it awake around the clock: the free plan's 100 compute-hours ran out on 2026-10-25 and RepoHQ was down until the monthly reset. Everything else, Slack alerts included, still runs every 5 minutes.
- **A Neon failure still alerts.** If Neon won't take the shipment (quota, outage), Slack gets `repohq:neon:ship`, nothing is marked shipped, and the next run retries.
- **Secrets are redacted** before anything ships: API keys, Slack/GitHub/Notion tokens, bearer tokens and database URLs, plus any data field named like a key or token.
- **Probes ship only when their status changes**, plus an hourly heartbeat, so the table holds transitions rather than identical "ok" rows.
- **Alerts group by fingerprint** `system:component:event`. There's one alert when something starts failing, a reminder every 6 hours while it stays down, and one message when it recovers.

## The event format

One JSON object per line:

```json
{"ts":"2026-10-10T20:00:00Z","system":"idea-factory","component":"pipeline","event":"tick",
 "status":"fail","level":"error","message":"what happened, in one line",
 "runId":"optional","subject":{"repo":"…","idea":"…","pr":"…"},"data":{},"durationMs":1234}
```

| Field | Values |
|---|---|
| `system` | `repohq`, `factory`, `idea-factory`, `ai-stack`, `openclaw`, `resource-center`, `launchd`, `github`, `vercel`, `slack` |
| `component` | the part: `pipeline`, `worker`, `litellm`, `cron:idea-to-repo`, `workflow:Cron — Sync` … |
| `event` | what happened, short: `tick`, `run`, `probe`, `launchd`, `M1` … |
| `status` | `ok`, `fail` (alerts), `start`, `skipped`, `info` (never alerts) |

## Writing events

| From | How |
|---|---|
| TypeScript (RepoHQ, factory) | `emitEvent({...})` from `factory/system/events.ts` |
| JavaScript (idea-factory) | `emit({...})` from `lib/events.js`; the pipeline, research, review and build use it |
| Python (OpenClaw front door) | `_emit(event, status, message)` in `~/ai-stack/repohq/frontdoor.py` |
| Shell (anything) | `~/ai-stack/bin/emit-event <system> <component> <event> <status> "<message>"` |
| CLI | `npm run events -- emit --system … --component … --event … --status … --message "…"` |

**Rule for new code:** log when something *happens* or *fails*, not on every quiet run. A 15-minute job that did nothing doesn't log, because its launchd exit code already shows it ran.

### Events the Agents page reads

The Agents page's **Idea pipeline** panel and **Subscriptions** cards (`src/lib/agents/usage-utils.ts`) are built from these events. So keep their shapes when you change them.

| Event | Written by | `data` |
|---|---|---|
| `idea-factory/research/run` (ok, fail) | `bin/idea-research.js` | `model`, `engine`, `trigger` (`daily` or `seed`), `capacity`; `durationMs` |
| `idea-factory/review/run` (ok, fail) | `bin/idea-review.js` | `model`, `engine`, `fellBack`, `primaryReason`; `durationMs` |
| `idea-factory/build/<milestone>` (start) | `bin/idea-build.js`, when a build begins | `milestone`, `manual`, `model`, `effort`, `timeoutMinutes` |
| `idea-factory/build/<milestone>` (ok, fail) | `bin/idea-build.js` | the above plus `engine`, `fellBack`, `sandbox` (`docker` or `host`), `testsPassing`, `prUrl`, `repaired`; a failed secret scan adds `findings` (file, line, kind; never the value); an MVP run adds `planned`, `completed`, `stopped`; `durationMs`. A go-live build is `build/GOLIVE` |
| `idea-factory/build/<milestone>` (info) | `bin/idea-build.js`: the secret scan asking for a repair, and what the credential broker provisioned | `findings` |
| `idea-factory/revenue/plan` (ok, fail) | `bin/idea-revenue.js` | `model`, `engine`, `fellBack`; `durationMs`; the message is the buyer and price |
| `idea-factory/claude/capacity` (info) | `lib/claude.js`, when the subscription can't take the work | `model`, `fallback` |
| `factory/copilot/usage` (info) | `factory/lib/copilot-quota.ts`: each cycle when the snapshot changed, and daily from the morning report | `installed`, `plan`, `percentRemaining`, `overagePermitted`, `resetDate`, `tasksToday`, `maxTasksPerDay`, `reviewsToday`, `maxReviewsPerDay` |

Autonomy events (the owner's call, 2026-10-12; component `autonomy`) aren't read by the Agents page, but the morning report and Slack depend on them:

| Event | Written by | Status |
|---|---|---|
| `factory/autonomy/merge` | `factory/run.ts` `automerge` | `ok` per PR merged; `fail` when GitHub refused the merge (closed by the next `ok`) |
| `factory/autonomy/hold` | `factory/run.ts` `automerge` | `info`, once per PR and reason the gate left for the owner |
| `factory/autonomy/revert` | `factory/run.ts` `watchMerged` | `fail` when a merge broke the base branch and was reverted (or couldn't be); `ok` once the base branch is green after the revert, which closes the alert |
| `idea-factory/autonomy/merge` | `bin/idea-pipeline.js` step 4a0 | `info` per PR the pipeline merged |
| `idea-factory/autonomy/revert` | `bin/idea-pipeline.js` | `fail` when a merge broke the live site's launch checks and was reverted; `ok` once the site passes them again. A revert the judge decided on is `info` |

Older events without `data` still show: the page reads the model and engine from the message where it can, and treats a missing duration as unknown, not zero.

## What the collector watches by itself

| Probe | Fails when |
|---|---|
| LiteLLM, Ollama (`:11434`), Headroom, OpenClaw gateway, RepoHQ (`/api/health`, hourly, 503 when it can't reach its database) | not reachable or HTTP 5xx |
| RepoHQ's Neon (`repohq:neon:ship`, hourly) | Neon rejects the shipment, e.g. the free plan's compute quota is used up |
| Docker | not running (factory cycles skip without the sandbox) |
| launchd: factory worker, OpenClaw gateway, Headroom, caffeinate | not running |
| launchd: idea pipeline, front door, the collector itself | last run exited non-zero, or not loaded |
| OpenClaw cron runs (briefing, companion messages, idea research) | a run finished with an error |
| GitHub Actions cron workflows (Github-HQ) | disabled (the 60-day inactivity trap) |
| LiteLLM log | Anthropic out of credit, a provider rejecting its key, rate limits |
| RepoHQ `automation_runs` (hourly) | a factory job or cron route failed |
| Vercel production deploys (every project) | the latest finished production deploy is `ERROR` or `CANCELED` |
| Live product: botchelor (`/api/health`) | not reachable or HTTP 5xx (503: it can't reach its database) |
| botchelor health detail (its cron secret from the keychain) | an episode report is waiting for review at `/admin`, a date is stuck generating for 15+ minutes, the paid-model daily cap is reached (dates fall back to the free model until 00:00 UTC), or the app recorded server errors in the last hour (API and page errors, route pattern and cleaned message) |
| RepoHQ health detail (`vault/repohq/CRON_SECRET` from the keychain, hourly) | the app recorded server errors in the last hour (pages, server components, actions: `src/instrumentation.ts` → `server_errors`). Its pages sit behind sign-in, so this is what catches a crashed dashboard (2026-10-19) |
| launchd: nightly factory backup | last run failed or not loaded |
| launchd: factory self-deploy (`com.repohq.factory.deploy`, every 10 min) | last run failed or not loaded; a failed deploy is also its own event, `factory:self-deploy:deploy` |
| launchd: ai-stack `com.localai.media-gen` (local image/video worker) | last run failed or not loaded |
| media-gen queue (`~/.local/state/media-gen-inbox`) | an image/video job has waited over an hour |
| OpenClaw model router (`~/.local/state/model-router.json`) | the free cloud models are rate-limited and OpenClaw is held on the local `local-chat` fallback (one alert, one recovery) |
| Secrets (`~/ai-stack/bin/secrets check`, daily) | a copy differs from the keychain, a secrets file is readable by others, or a backup holds a live key |

Ollama isn't watched as a launchd job: Ollama.app owns port 11434, so `homebrew.mxcl.ollama` exits 1 by design and `com.ollama.ollama` idles while Ollama is up. The `:11434` probe says whether it's running.

## Operations

| What | Where |
|---|---|
| Collector | launchd `com.user.system-events`, every 5 min (Neon hourly), installed by `factory/bin/install-launchd.sh`, log `~/.system-events/collector.log` |
| Run it now | `npm run events -- collect` (`--dry-run` ships and posts nothing) |
| What's failing / volume | `npm run events -- summary`; `npm run events -- tail` |
| Table | `system_events` (migration `factory/sql/0005`), pruned to 90 days |
| Slack | bot token in keychain `system-events-slack-token` (the companion's Slack app); channel in `factory.config.json` → `alerts.slackChannel` (#team-agents) |
| Local file | `~/.system-events/events.jsonl`, rotated at 5 MB, 10 archives kept |

## The companion knows the state too

When something starts failing or recovers, the collector rewrites the **system brief** in the OpenClaw agents' `AGENTS.md`. So asking the companion on Slack or WhatsApp "what's broken?" gets the current answer. See [system-overview.md](system-overview.md#how-an-ai-agent-gets-context).

## Not covered yet

- **Vercel runtime errors** inside running apps. Failed production deploys are covered; per-request errors still live only in Vercel.
- **The Resource Center Bridge** runs in the browser and has no server to log from.
