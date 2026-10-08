# Reference

Quick-lookup tables for ports, paths, models, secrets, and external docs.

---

## Ports

| Port | Service | Bind |
|---|---|---|
| `11434` | Ollama | localhost |
| `8787` | Headroom | localhost |
| `4000` | LiteLLM | 127.0.0.1 |
| `18789` | OpenClaw gateway | loopback |
| `3000` | OpenHands (on-demand) | 127.0.0.1 |

**Shared endpoint:** `http://localhost:4000/v1` · **key:** `sk-local-ai`

---

## Models

| Alias | Backing | Provider | Cost |
|---|---|---|---|
| `local-coder` | `qwen2.5:7b-coding` | Ollama | $0 |
| `local-coder-14b` | `qwen2.5-coder:14b` | Ollama | $0 |
| `local-qwen3` | `qwen3:8b` | Ollama | $0 |
| `cloud-or` | `nvidia/nemotron-3-ultra-550b-a55b:free` | OpenRouter | free |
| `cloud-smart` | `anthropic/claude-sonnet-4-6` | Anthropic | paid |
| `free-agent` | `nemotron-3-super` | Ollama Cloud | free |
| `free-agent-b` | `cohere/north-mini-code:free` | OpenRouter | free |
| `free-agent-c` | `gemini-3.6-flash` | Gemini (AI Studio) | free |
| `local-agent` / `local-small` | `qwen2.5:7b-coding` | Ollama | $0 |

> Free pool (`free-agent*`) is managed by [`factory/scout.ts`](../../factory/scout.ts) in marker blocks in `litellm/config.yaml` — don't hand-edit inside the markers.

---

## Key paths

| Path | What |
|---|---|
| `~/ai-stack/` | Live stack configs (git repo) |
| `~/ai-stack/litellm/config.yaml` | LiteLLM model list + routing |
| `~/ai-stack/litellm/.env` | Cloud API keys (**gitignored**) |
| `~/ai-stack/litellm/docker-compose.yml` | LiteLLM container |
| `~/ai-stack/openhands/docker-compose.yml` | OpenHands (on-demand) |
| `~/ai-stack/CLAUDE.md` | Auto-loaded context for Claude Code |
| `~/ai-stack/.github/copilot-instructions.md` | Auto-read context for Copilot |
| `~/.openclaw/openclaw.json` | OpenClaw config (**contains secrets**) |
| `~/.openclaw/workspace-companion/` | Companion persona + memory |
| `~/.openclaw/extensions/openclaw-web-search/index.ts` | Web-search plugin (**patched** → Ollama cloud) |
| `~/Library/LaunchAgents/homebrew.mxcl.ollama.plist` | Ollama service + tuning env |
| `~/Library/LaunchAgents/com.localai.headroom.plist` | Headroom service |
| `~/Library/LaunchAgents/ai.openclaw.gateway.plist` | OpenClaw gateway service |
| `~/Library/LaunchAgents/com.user.docker-autostart.plist` | Docker autostart on login |

---

## Secrets (keep private, never commit)

| Secret | Location |
|---|---|
| Anthropic / OpenRouter keys | `~/ai-stack/litellm/.env` |
| Ollama cloud key (`OLLAMA_API_KEY`) | ollama + openclaw gateway plists |
| OpenClaw gateway token, Notion/Google/Whisper keys | `~/.openclaw/openclaw.json` |
| LiteLLM master key | `sk-local-ai` (config.yaml) |

---

## Scheduled jobs (OpenClaw cron)

| Name | Schedule | Agent | Model |
|---|---|---|---|
| `companion-morning` | 7:30 AM | companion | cloud-smart |
| `companion-evening` | 9:00 PM | companion | cloud-smart |
| `morning-briefing` | 8:00 AM | (isolated) | cloud-smart |

---

## External documentation

| Tool | Link |
|---|---|
| Ollama | https://docs.ollama.com |
| LiteLLM | https://docs.litellm.ai |
| OpenClaw | https://docs.openclaw.ai |
| OpenCode | https://opencode.ai |
| Continue | https://continue.dev |
| Aider | https://aider.chat |
| OpenHands | https://github.com/OpenHands/OpenHands |
| OpenRouter | https://openrouter.ai |
| Anthropic Console | https://console.anthropic.com |
| Dify (evaluated, not used) | https://dify.ai |

---

## Companion (Claude Code) context

This platform is also documented for AI sessions in three tiers:
- **Auto-loaded:** `~/ai-stack/CLAUDE.md`, `~/ai-stack/.github/copilot-instructions.md`, Claude Code memory index
- **Recalled:** Claude Code memory files (`ai-coding-stack.md`, `ollama-openclaw-setup.md`)
- **On-demand:** the `/ai-stack` skill (live health check), these docs (`docs/ai-stack/` in Github-HQ)
