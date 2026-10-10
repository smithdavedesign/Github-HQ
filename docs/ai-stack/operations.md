# Operations Runbook

Day-to-day operation, health checks, recovery, and the hard-won gotchas.

---


## Logs and alerts

Every service here is watched by the system-events collector ([logging](../logging.md)):
- LiteLLM, Ollama, Headroom and the OpenClaw gateway are probed;
- the launchd jobs and Docker are checked;
- the LiteLLM log is scanned for provider errors (credit, auth, rate limits).

Failures and recoveries post to Slack **#team-agents**. Scripts log with `~/ai-stack/bin/emit-event <system> <component> <event> <status> "<message>"`.
## Health check

```bash
ollama ps                                                                  # UNTIL = "Forever"
curl -s localhost:4000/v1/models -H "Authorization: Bearer $LITELLM_MASTER_KEY"    # LiteLLM (5 models); export it from ~/ai-stack/litellm/.env
curl -s localhost:8787/v1/models -H "Authorization: Bearer $LITELLM_MASTER_KEY"    # Headroom → LiteLLM
lsof -nP -iTCP:18789 -sTCP:LISTEN                                          # OpenClaw gateway
```

For Claude Code sessions, the `/ai-stack` skill runs a full live health check automatically.

---

## Start / stop / reload

| Action | Command |
|---|---|
| Reload LiteLLM config | `docker compose -f ~/ai-stack/litellm/docker-compose.yml restart` |
| Apply LiteLLM key (.env) changes | `docker compose -f ~/ai-stack/litellm/docker-compose.yml up -d` |
| Reload OpenClaw gateway | `openclaw daemon restart` |
| Reload Ollama env (plist change) | `launchctl bootout gui/$(id -u)/homebrew.mxcl.ollama && launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/homebrew.mxcl.ollama.plist` |
| Start OpenHands | `docker compose -f ~/ai-stack/openhands/docker-compose.yml up -d` |
| Stop OpenHands | `docker compose -f ~/ai-stack/openhands/docker-compose.yml down` |

---

## Memory management (16 GB)

- Local models evict/reload when you switch between them (keep-alive is ∞ for whichever is loaded).
- **Big local model XOR OpenHands** — never both.
- Docker is capped ~8 GB. To change it, **use the Docker Desktop GUI** (Settings → Resources → Memory) — *not* the CLI (Docker rewrites `settings-store.json` on shutdown and hard-killing it to force the edit takes all containers down).
- Long uptime + heavy swap → a real restart clears it and makes things snappy again.

---

## Reboot resilience

All services are wired to auto-start (see [architecture](architecture.md#deployment--resilience)):

| Service | Mechanism |
|---|---|
| Ollama | Homebrew LaunchAgent (`RunAtLoad`) |
| Headroom | launchd `com.localai.headroom` |
| OpenClaw | launchd `ai.openclaw.gateway` |
| Docker | launchd `com.user.docker-autostart` |
| LiteLLM | Docker `restart: unless-stopped` |

After a real reboot, verify with the health check above. OpenHands stays down until started manually.

> ⚠️ As of last check the machine had 80+ days uptime — resilience is configured but **unproven by an actual reboot**. A genuine restart (not sleep) both validates it and clears swap.

---

## Troubleshooting

| Symptom | Cause / Fix |
|---|---|
| **Every request ~85s** (not just first) | Model being evicted. Check `ollama ps` shows `UNTIL=Forever`. If the Ollama.app GUI relaunched and stole `:11434`, quit it: `osascript -e 'quit app "Ollama"'` then kickstart the Homebrew service. |
| **Agents can't reach models** | LiteLLM down → `docker compose -f ~/ai-stack/litellm/docker-compose.yml up -d`; verify `curl localhost:4000/v1/models`. |
| **`cloud-or` 404 / "unavailable for free"** | OpenRouter rotated the free slug. Re-pick from `curl -s https://openrouter.ai/api/v1/models` (pricing prompt+completion `"0"`), update `cloud-or` in `config.yaml`, restart. |
| **Cloud call auth error** | Missing/expired key in `~/ai-stack/litellm/.env` → fix, `up -d`. Verify present: `docker exec litellm sh -c 'echo ${#ANTHROPIC_API_KEY}'`. |
| **Companion fabricates "news"** | `cloud-or`/local models don't reliably call web search. Use `cloud-smart` for anything needing live data. |
| **Web search "unauthorized"** | Needs `OLLAMA_API_KEY` in the gateway + Ollama envs; the web-search plugin is patched to hit Ollama cloud (see reference). |
| **Config change ignored** | LiteLLM: `restart` reloads config, `.env` needs `up -d`. OpenClaw: `openclaw daemon restart`. |

---

## Backups

- OpenClaw state: `openclaw backup` (see `openclaw backup --help`).
- Configs are mostly plain files under `~/ai-stack/` (version-controlled) and `~/.openclaw/`.
- **Secrets are NOT in git** — back up `~/ai-stack/litellm/.env` and `~/.openclaw/openclaw.json` separately and privately.
