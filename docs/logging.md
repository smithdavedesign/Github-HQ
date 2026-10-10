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
                                                                     ├─▶ collector (launchd, every 5 min) ──▶ Neon system_events (90 days)
probes: services, launchd, OpenClaw cron, GitHub crons, LiteLLM log ─┘            │
RepoHQ automation_runs (factory jobs, cron routes) ──────────────────────────────┤
                                                                                  ├─▶ Slack #team-agents: 🔴 failing · 🟠 still failing (6h) · 🟢 recovered
                                                                                  └─▶ morning email (Ops) · Agents page "System log"
```

- **The file is the source.** Writing to it works offline and from any language. Neon is the searchable index.
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

## What the collector watches by itself

| Probe | Fails when |
|---|---|
| LiteLLM, Ollama, Headroom, OpenClaw gateway, RepoHQ (`/login`) | not reachable or HTTP 5xx |
| Docker | not running (factory cycles skip without the sandbox) |
| launchd: factory worker, OpenClaw gateway, Headroom, Ollama, caffeinate | not running |
| launchd: idea pipeline, front door, the collector itself | last run exited non-zero, or not loaded |
| OpenClaw cron runs (briefing, companion messages, idea research) | a run finished with an error |
| GitHub Actions cron workflows (Github-HQ) | disabled (the 60-day inactivity trap) |
| LiteLLM log | Anthropic out of credit, a provider rejecting its key, rate limits |
| RepoHQ `automation_runs` | a factory job or cron route failed |

`homebrew.mxcl.ollama` is deliberately not watched: it exits 1 by design, because Ollama.app owns port 11434.

## Operations

| What | Where |
|---|---|
| Collector | launchd `com.user.system-events`, every 5 min, installed by `factory/bin/install-launchd.sh`, log `~/.system-events/collector.log` |
| Run it now | `npm run events -- collect` (`--dry-run` ships and posts nothing) |
| What's failing / volume | `npm run events -- summary`; `npm run events -- tail` |
| Table | `system_events` (migration `factory/sql/0005`), pruned to 90 days |
| Slack | bot token in keychain `system-events-slack-token` (the companion's Slack app); channel in `factory.config.json` → `alerts.slackChannel` (#team-agents) |
| Local file | `~/.system-events/events.jsonl`, rotated at 5 MB, 10 archives kept |

## Not covered yet

- **Vercel runtime errors** (RepoHQ, Open-Travel and the other apps). Vercel keeps them; the next step is a probe through the Vercel API.
- **The Resource Center Bridge** runs in the browser and has no server to log from.
