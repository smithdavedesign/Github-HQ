# Personal context policy

The goal is an assistant (the OpenClaw companion) that knows the owner's projects, career and life, without ever touching banking or financial data, and without employer data leaving the machine. Several systems already hold slices of that context: RepoHQ (projects), the Resource Center (bookmarks), Notion (ideas and tasks), and the companion's own memory. This page sets one rule set for all of them.

**The core decision: list what may be read, rather than what is excluded.** "Everything except banking" leaks, because financial data turns up in email, screenshots, bookmarks and documents. Each consumer instead names the sources it may read, and the financial class is never ingested at all.

## Data classes

| Class | Examples | May go to |
|---|---|---|
| **Public** | Open web, public repos, articles and docs | Any model |
| **Personal** | Personal projects and private repo metadata, career and learning, ideas, calendar titles, notes, the companion's memory | Local models; `cloud-smart` (Anthropic, which doesn't train on API data); the free pool **(open decision, below)** |
| **Work-confidential** | Anything from the owner's employer: work bookmarks, internal hosts and Jira, innersource repos, work email and documents | **Local models only** (`local-*`) |
| **Financial** | Banks, cards, loans and mortgages, investments, taxes, property documents | **Nothing. Never ingested, never sent.** |

When something fits two classes, the stricter one wins.

## Consumers

| Consumer | May read | Never reads | Models |
|---|---|---|---|
| **Companion** (OpenClaw, WhatsApp) | Its memory files; calendar event titles; Notion Idea Board and task boards; RepoHQ portfolio and decision states; email **only when asked about a specific message** | Financial senders and documents; bulk inbox ingestion into memory; work-confidential content | Free pool today (see open decision) |
| **Idea research** (Claude Code on the Pro subscription; scout as fallback) | The public web; the Idea Board; repo names and descriptions | Any personal or work source (no `USER.md` or memory; Claude Code runs with no MCP servers, connectors or user settings) | Claude Pro subscription, then the free pool |
| **RepoHQ factory** | Allowlisted repos, inside the Docker sandbox | Anything outside the repo | Private repos: local or paid, never free cloud |
| **Resource Center** (bookmarks) | Bookmarks except the finance topics | Finance & Banking, Finance Docs & Property | Work topics: local only; the rest: any |

## What enforces it

| Rule | Enforced by |
|---|---|
| Financial bookmarks never sent | Resource Center site (`AI_SAFE`) |
| Work bookmarks only to local models | Resource Center site (left out of cloud prompts) **and** the Bridge extension: it accepts only `local-*`, `free-agent*` and `cloud-smart`, and a request flagged `localOnly` or naming an internal host never reaches a cloud model, fallback included |
| Private repos never to free cloud | Factory model router (`allowFreeCloud` per repo) |
| Scout has no personal context | Separate OpenClaw agent and workspace, no `USER.md` or memory, a tool allowlist on its cron job |
| Companion's read allowlist | **Policy only**: written in the companion's `AGENTS.md`. The companion has full, ungated exec (the owner's choice), so nothing technical stops it reading other files. The separation from scout limits what untrusted web content can reach. |

## Open decision: the companion's model

The companion's primary model is the free pool (`free-agent`), so its memory and personal conversations go to free providers, and some free tiers log prompts. The options:

1. **Keep the free pool.** $0, best answers at $0, personal content shared with free providers.
2. **`cloud-smart` first.** Anthropic, no training on API data, about $0.05 a message. It needs Anthropic credit, which ran out on 2026-10-10.
3. **Local first** (`local-coder`). Fully private, but noticeably weaker conversation and memory on a 16 GB Mac.

Until the owner chooses, the companion stays on the free pool, and work-confidential and financial content stay out of it by policy.

## Next (after the 30-day window)

One context index instead of each consumer wiring its own sources. RepoHQ already exposes an MCP server: the companion would query RepoHQ (projects and career evidence), a Resource Center export (interests, minus finance and work) and Notion, each tagged with its data class, so the class rules above are applied in one place rather than per tool.
