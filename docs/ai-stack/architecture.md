# Architecture

Diagrams for the whole platform. All render natively on GitHub (Mermaid).

- [System topology](#system-topology)
- [Request flow](#request-flow)
- [Model routing & cost ladder](#model-routing--cost-ladder)
- [Personal assistant](#personal-assistant)
- [Deployment & resilience](#deployment--resilience)

---

## System topology

```mermaid
flowchart LR
    subgraph agents["Agents"]
        direction TB
        OC["OpenCode"]
        AID["Aider"]
        CON["Continue"]
        OH["OpenHands<br/>(on-demand)"]
        CMP["OpenClaw companion<br/>(WhatsApp)"]
    end

    HR["Headroom :8787<br/>context compression"]
    LL["LiteLLM :4000<br/>router + fallbacks"]
    OLLAMA["Ollama :11434<br/>Flash-Attn · q8 KV · keep-alive ∞"]

    subgraph local["Local models ($0)"]
        M1["local-coder (Qwen2.5-Coder-7B)"]
        M2["local-coder-14b (8k ctx)"]
        M3["local-qwen3 (Qwen3-8B)"]
    end
    subgraph cloud["Cloud escape hatches"]
        C1["cloud-or · Nemotron 550B · free"]
        C2["cloud-smart · Claude Sonnet · paid"]
    end

    OC & AID & CON & OH & CMP --> HR --> LL
    LL --> OLLAMA --> M1 & M2 & M3
    LL --> C1
    LL --> C2

    classDef local fill:#e6f4ea,stroke:#34a853;
    classDef cloud fill:#fde7e9,stroke:#ea4335;
    class OLLAMA,M1,M2,M3 local;
    class C1,C2 cloud;
```

---

## Request flow

A normal coding request, warm path:

```mermaid
sequenceDiagram
    participant A as Agent (OpenCode)
    participant H as Headroom :8787
    participant L as LiteLLM :4000
    participant O as Ollama :11434
    A->>H: chat/completions (model=local-coder)
    H->>H: compress context (trim logs/history)
    H->>L: forward (OpenAI format, key sk-local-ai)
    L->>O: route to ollama_chat/qwen2.5:7b-coding
    O-->>L: completion (warm ~1-2s, cold ~80s once)
    L-->>H: response
    H-->>A: response
    Note over L,O: On local error, LiteLLM retries cloud-or (free) then cloud-smart (paid)
```

---

## Model routing & cost ladder

```mermaid
flowchart TD
    REQ["Incoming request"] --> DEF{"model specified?"}
    DEF -->|default| LC["local-coder ($0)"]
    DEF -->|explicit| PICK["local-coder-14b / local-qwen3 / cloud-or / cloud-smart"]
    LC -->|success| DONE["response"]
    LC -->|error| F1["cloud-or · free"]
    F1 -->|success| DONE
    F1 -->|error| F2["cloud-smart · paid"]
    F2 --> DONE

    classDef free fill:#e6f4ea,stroke:#34a853;
    classDef paid fill:#fde7e9,stroke:#ea4335;
    class LC,F1 free;
    class F2 paid;
```

**Key rule:** fallback is **error-triggered**, not quality-based. Default stays 100 % local/$0; cloud only fires on failure or when you pick it explicitly.

---

## Personal assistant

The companion is a dedicated OpenClaw agent, separate from the coding setup:

```mermaid
flowchart TB
    WA["📱 WhatsApp<br/>(you)"] <-->|routed| GW["OpenClaw gateway :18789"]
    GW --> CMP["companion agent<br/>model: cloud-smart"]

    subgraph mem["File-based memory (workspace-companion/)"]
        SOUL["SOUL.md · personality"]
        USER["USER.md · your profile"]
        LT["MEMORY.md · long-term"]
        DAY["memory/YYYY-MM-DD.md · daily"]
    end
    CMP -->|reads every session| mem
    CMP -->|writes as it learns| mem

    CRON["Cron scheduler"] -->|7:30am| MORN["morning check-in"]
    CRON -->|9:00pm| EVE["evening wind-down"]
    MORN & EVE --> CMP
    CMP -->|via Headroom→LiteLLM| CLOUD["cloud-smart (Claude)"]

    MAIN["main agent (coding)<br/>local-coder"]:::muted
    GW -.not routed to phone.-> MAIN
    classDef muted fill:#f1f3f4,stroke:#9aa0a6,color:#5f6368;
```

Memory is **files**, loaded into every session (incl. scheduled ones) — so the companion stays in-character and context-aware without a live conversation thread.

---

## Deployment & resilience

Everything auto-starts on boot; no manual bring-up:

```mermaid
flowchart TB
    BOOT["macOS login / boot"] --> LA

    subgraph LA["launchd agents"]
        OLA["homebrew.mxcl.ollama<br/>→ Ollama :11434"]
        HRA["com.localai.headroom<br/>→ Headroom :8787"]
        OCA["ai.openclaw.gateway<br/>→ OpenClaw :18789"]
        DKA["com.user.docker-autostart<br/>→ Docker Desktop"]
    end

    DKA --> DOCKER["Docker daemon"]
    DOCKER -->|restart: unless-stopped| LLC["litellm container :4000"]

    OHND["OpenHands :3000"]:::od
    NOTE["started manually when needed"]:::od --- OHND
    classDef od fill:#fff4e5,stroke:#f9ab00;
```

| Service | Mechanism | Auto-start |
|---|---|---|
| Ollama | Homebrew LaunchAgent | ✅ |
| Headroom | launchd `com.localai.headroom` | ✅ |
| OpenClaw gateway | launchd `ai.openclaw.gateway` | ✅ |
| Docker Desktop | launchd `com.user.docker-autostart` | ✅ |
| LiteLLM | Docker `restart: unless-stopped` | ✅ (with Docker) |
| OpenHands | manual `docker compose up` | ❌ on-demand |

> Note: resilience is wired but, as of last check, hadn't been exercised by a real reboot (uptime was 80+ days). See [operations](operations.md#reboot-resilience).
