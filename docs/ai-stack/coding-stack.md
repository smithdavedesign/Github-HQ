# Coding Stack

Local-first coding with a cloud fallback ladder, exposed through one endpoint.
See [architecture](architecture.md) for diagrams.

**Endpoint:** `http://localhost:4000/v1` (LiteLLM) or `http://localhost:8787/v1` (through Headroom) · **key:** `$LITELLM_MASTER_KEY` (in `~/ai-stack/litellm/.env`)

---

## Models

| Alias | Backing model | Cost | Context | Use for |
|---|---|---|---|---|
| `local-coder` | Qwen2.5-Coder-7B (`qwen2.5:7b-coding`) | $0 | 32k* | **Default** daily coding |
| `local-coder-14b` | Qwen2.5-Coder-14B (`qwen2.5-coder:14b`) | $0 | 8k | Stronger local coder (8k = GPU-fit limit on 16 GB) |
| `local-qwen3` | Qwen3-8B (`qwen3:8b`) | $0 | 32k* | General local reasoning |
| `cloud-or` | `nvidia/nemotron-3-ultra-550b-a55b:free` via [OpenRouter](https://openrouter.ai) | **free** | 128k | Hard tasks, stay free (verbose; weak tool-calling) |
| `cloud-smart` | `anthropic/claude-sonnet-4-6` via [Anthropic](https://console.anthropic.com) | **paid** | 200k | Top quality, reliable tool-calling |
| `free-agent` / `-b` / `-c` | **Free pool**: Ollama Cloud (`nemotron-3-super`) · OpenRouter `:free` · Gemini (AI Studio) | **free** | varies | Agentic coding without exhausting one provider's quota |
| `local-agent` / `local-small` | Qwen2.5-Coder-7B | $0 | 16k | Factory-scoped local edits |

\* Context passed to Headroom, which compresses before the model's real window.

**Free-model pool (RepoHQ factory):** `free-agent/-b/-c` spread agentic work across Ollama Cloud, OpenRouter, and Gemini free tiers so no single quota (e.g. OpenRouter's 50/day) runs dry. The pool members + fallback ladders are managed by [`factory/scout.ts`](../../factory/scout.ts), which writes into **marker blocks** in `config.yaml` — don't hand-edit inside the `# >>> repohq-factory` markers. Keys: `OPENROUTER_API_KEY`, `OLLAMA_API_KEY`, `GEMINI_API_KEY` in `litellm/.env`.

**Fallback ladders:** `local-coder → free-agent → free-agent-b → free-agent-c → cloud-smart` (free-first, paid only as last resort); `cloud-or → pool`.

Config: `~/ai-stack/litellm/config.yaml` · reload with `docker compose -f ~/ai-stack/litellm/docker-compose.yml restart`.

### Vercel MCP (deploy tooling for agents)
Vercel's official MCP (`https://mcp.vercel.com`, OAuth) is configured for **Claude Code** (`~/.claude.json`) and **OpenCode** (`opencode.json`) — gives agents structured deploy/project/analytics tools. **Not** added to the WhatsApp companion (full-exec + untrusted content = too much to hand your Vercel account). Activate: restart the client, authorize via OAuth (`/mcp` in Claude Code). Token-based CLI deploys are blocked on this account (personal "northstar" account; CLI 54.9.1 team-enumeration quirk + read-scoped token) — use the MCP or a full-scope token.

---

## Ollama

Local model server. [Docs](https://docs.ollama.com) · runs as a Homebrew LaunchAgent on `:11434`.

**Tuning** (in `~/Library/LaunchAgents/homebrew.mxcl.ollama.plist`):

| Env | Value | Why |
|---|---|---|
| `OLLAMA_FLASH_ATTENTION` | `1` | Faster attention on Apple Silicon |
| `OLLAMA_KV_CACHE_TYPE` | `q8_0` | Halves KV-cache memory vs f16 |
| `OLLAMA_KEEP_ALIVE` | `-1` | Ignored by Ollama.app. The effective value is `keep_alive: 70m` per model in `litellm/config.yaml` (written by the factory scout): warm across the hourly factory cycles, released when idle. Pinning forever (`-1`) held 5.5 GB around the clock and pushed the 16 GB Mac into memory-pressure warning (2026-10-10). |
| `OLLAMA_API_KEY` | *(set)* | Authenticates Ollama cloud web-search |

> The GUI **Ollama.app is disabled** (`launchctl disable com.ollama.ollama`) so it can't steal `:11434` with an untuned config.

Check: `ollama ps` → `UNTIL` should read `Forever`.

---

## Headroom

Context-compression proxy on `:8787`. Trims logs, history, and tool output before they reach the model — makes small local models punch above their context weight. Runs as launchd `com.localai.headroom`, forwards to LiteLLM.

---

## LiteLLM

OpenAI-compatible **router** on `:4000`, in Docker. [Docs](https://docs.litellm.ai) · master key from `LITELLM_MASTER_KEY` in `litellm/.env` (`master_key: os.environ/LITELLM_MASTER_KEY`).

- Config bind-mounted: `~/ai-stack/litellm/config.yaml`
- Keys in `~/ai-stack/litellm/.env` (gitignored) → `docker compose up -d` to apply
- Compose: `~/ai-stack/litellm/docker-compose.yml`

```bash
docker compose -f ~/ai-stack/litellm/docker-compose.yml restart   # reload config.yaml
docker compose -f ~/ai-stack/litellm/docker-compose.yml up -d     # apply .env changes
```

---

## Agents

All point at the one endpoint with the LiteLLM master key. Rotating it means updating each tool's config (OpenClaw `openclaw.json` and `agents/*/agent/models.json`, Continue, OpenCode, Aider, OpenHands) and `FACTORY_LITELLM_KEY` in `~/.repohq-factory/env`.

| Agent | Type | Config | Notes |
|---|---|---|---|
| [OpenCode](https://opencode.ai) | Terminal | `~/.config/opencode/opencode.json` | Default `local/local-coder`; `/models` to switch |
| [Continue](https://continue.dev) | VS Code | `~/.continue/config.yaml` | chat / edit / apply roles |
| [Aider](https://aider.chat) | Terminal (git) | `~/.aider.conf.yml` + `~/.aider.model.metadata.json` | `aider --model openai/cloud-smart` |

All route through Headroom (`:8787/v1`) so they get context compression.

---

## OpenHands

Autonomous multi-step agent. [Repo](https://github.com/OpenHands/OpenHands) · UI on `:3000`, **on-demand** (not auto-started — too heavy to keep resident).

```bash
docker compose -f ~/ai-stack/openhands/docker-compose.yml up -d    # start → http://localhost:3000
docker compose -f ~/ai-stack/openhands/docker-compose.yml down     # stop (reclaim RAM)
```

- Configure the LLM in the UI: model `openai/cloud-smart` (or `cloud-or`), Base URL `http://host.docker.internal:8787/v1`, the LiteLLM master key.
- **Use a cloud model** — a big local model + OpenHands won't fit in 16 GB simultaneously.
- Settings persist in `~/.openhands/openhands.db`.

---

## Hardware ceiling

16 GB M1 Pro. 7–8B comfortable, 14B only at 8k context, no 30B. Docker capped ~8 GB. See [operations](operations.md) for memory management.
