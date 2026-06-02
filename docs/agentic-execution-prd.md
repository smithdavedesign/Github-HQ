# RepoHQ × AI-Took-My-Job — Agentic Portfolio Execution PRD

> **The core thesis:** RepoHQ already has Find, Prioritize, and Measure.
> This integration adds Execute. That's why it feels different from every
> previous roadmap item — it's not another dashboard card. It's the loop closing.

---

## Scope: Personal Use First

**This integration is built for one user (you) operating on your own repos.**

AI-Took-My-Job is currently single-operator: one username/password per instance, service tokens for API access, no self-service signup flow. It is production-capable and easy to deploy (Render `render.yaml` or `docker-compose up`) but not yet multi-tenant. Building this integration for others requires ~3 months of auth work on Nexus's side (user registration, workspace RBAC, persistent sessions) that hasn't happened yet.

**Do not design for multi-user in Phase A-D.** Validate the loop for yourself first. If advisor accuracy and agent success rates are good after 6-8 weeks, the multi-user question becomes worth answering.

---

## Context

RepoHQ is a portfolio intelligence layer that generates quantified, prioritised action recommendations ("deploy repo X for +14 opportunity points", "fix 2 security alerts in repo Y"). AI-Took-My-Job (AI-DevOps Nexus) is a self-hosted feedback-to-engineering control plane with a review-gated queue, BullMQ async workers, and a contract-based Claude agent execution pipeline that clones repos, creates isolated branches, runs an agent, and promotes changes as PRs.

**Two complementary input channels into the same execution pipeline:**
- **Chrome extension** — captures user-reported bugs from running web apps (page URL, console errors, severity) → feeds Nexus triage queue
- **RepoHQ advisor** — generates portfolio-scored, quantified work items (health improvements, security fixes, opportunity gains) → feeds the same Nexus queue

The integration closes the loop RepoHQ can't close alone: **insight → execution**. The advisor tells you what to do; the agent does it.

**The biggest risk is not agent quality. It is advisor quality.**

If the advisor predicts "+14 opportunity points" and the real delta is +3, we've built a beautiful automation system around bad prioritisation. Tracking predicted vs actual impact — from Day 1 — is non-negotiable. Advisor accuracy is the number that determines how much automation is safe to add over time.

---

## Competitive Context (as of mid-2026)

| Tool | Portfolio Scoring | Agent Execution | Human Gate |
|------|-----------------|-----------------|------------|
| RepoHQ alone | ✅ quantified | ❌ | — |
| AI-Took-My-Job alone | ❌ | ✅ | ✅ |
| Linear + AI | weak | emerging | ✅ |
| Devin | ❌ | ✅ | minimal |
| Copilot Workspace | ❌ | plan-only | ✅ |
| OpenHands | ❌ | ✅ | none |
| **This integration** | **✅ quantified** | **✅** | **✅** |

**What's novel:** Portfolio-level prioritisation (not arbitrary feature work) flowing into a review-gated execution pipeline. No one else connects "scored opportunity → approved work item → agent branch → PR" as a single product flow.

**Known failure modes from research to design around:**
1. Context loss at 70%+ capacity → keep briefs tight, one action per execution
2. Large diffs with silent bugs → limit scope to high-confidence task types only
3. Approval bottleneck → batch low-risk changes, score-based auto-approve threshold (only after accuracy proven)
4. Multi-agent coordination gaps → sequential, not parallel, execution per repo

---

## Scope — Task Types (ordered by risk, low → high)

Execute in this order. Do not skip ahead before proving accuracy at each tier.

**Tier 1 — Zero Risk (start here)**
- **Missing documentation** — README gaps identified by health scorer, docs-only changes. Any failure is immediately obvious. Revert is trivial.

**Tier 2 — Low Risk**
- **Dependency updates** — Dependabot-style version bumps. Clear test criteria (tests pass = success). Revert is a one-line diff.
- **CI/test fixes** — Flaky tests, broken CI configs. Contained, measurable outcome.

**Tier 3 — Medium Risk (unlock after Tier 1-2 proven)**
- **Security alert fixes** — Only after advisor accuracy is established. A wrong security fix introduces new vulnerabilities, which is worse than the original alert.

**NOT in scope:**
- Feature work, architectural changes, major refactors
- Cross-repo coordinated changes
- Anything touching auth, payments, or data migrations

---

## Architecture

```
RepoHQ (Intelligence)                   AI-Took-My-Job (Execution)
━━━━━━━━━━━━━━━━━━━━━                   ━━━━━━━━━━━━━━━━━━━━━━━━━
AdvisorCard
  "Queue this" button
       │ POST /internal/agent-tasks
       │   { objective, repo,
       │     acceptanceCriteria,
       │     predictedDelta }        ← tracked from Day 1
       └──────────────────────────────→ Review Queue
                                             │ (human approves)
       ←─── taskId stored in            Worker prepares context
            portfolio_events ──────────→      │
            { predictedDelta }          Agent reads
                                        get_coding_brief ←── RepoHQ MCP
                                              │
                                        Isolated branch
                                        Code changes
                                        .nexus/output.json
                                              │
                                        PR created + merged
                                              │
                                        Webhook → RepoHQ
       ←─── health resync ─────────────  'agent_pr_merged'
            actualDelta computed
            accuracy logged
```

**Key integration points:**

- **RepoHQ → AI-Took-My-Job:** `POST /internal/agent-tasks` with `objective`, `targetRepository`, `acceptanceCriteria`, and `predictedDelta` (the advisor's expected score change)
- **AI-Took-My-Job agent → RepoHQ MCP:** calls `get_coding_brief(repo_name)` to populate `.nexus/context.json`
- **AI-Took-My-Job → RepoHQ:** webhook `POST /api/webhooks/agent-events` writes `portfolio_events` with outcome
- **RepoHQ on merge:** triggers resync, computes `actualDelta`, logs advisor accuracy
- **gstack as AGENT_EXECUTION_COMMAND:** skills routed by risk tier (docs → direct Claude, deps → `/ship`, security → `/investigate`)

---

## User Journey (Target State)

1. RepoHQ advisor card shows: "Fix missing README sections — +8 health [Queue →]"
2. User clicks "Queue" → task appears in AI-Took-My-Job review queue with full context
3. User reviews in Nexus queue: sees objective, repo, acceptance criteria, RepoHQ context brief
4. User approves → worker prepares context → agent reads `get_coding_brief` via MCP
5. Agent executes on isolated branch, writes `.nexus/output.json`
6. Validation runs (tests pass?)
7. Nexus shows diff + output → user approves → PR created
8. User merges PR in GitHub
9. RepoHQ webhook triggers → resync → `actualDelta` computed → accuracy logged
10. Agent Performance page updates: predicted +8, actual +7. Accuracy: 87%

---

## Implementation Phases

### Phase A — The Bridge + Accuracy Foundation (1-2 days)

**The real MVP.** Proves one thing: when RepoHQ suggests something, do users actually click Queue?

Stop here for at least one week before building Phase A.5. If nobody clicks Queue, Phases B-E don't matter.

**RepoHQ changes:**
- New env vars: `NEXUS_API_URL`, `NEXUS_API_TOKEN`
- New server action: `src/lib/actions/nexus.ts` → `queueAdvisorAction(advisorAction)`
  - Maps `AdvisorAction` → `POST /internal/agent-tasks` payload
  - **Passes `predictedDelta` from `AdvisorAction.estimatedImpact`** (critical for accuracy tracking)
  - Stores returned `taskId` in `portfolio_events` (eventType: `'agent_task_queued'`, metadata: `{ taskId, predictedDelta, nexusStatus }`)
- New UI: `QueueButton` on advisor card items (spinner while queuing, task ID badge when queued)
- New settings section: Nexus connection (URL + token)

**No AI-Took-My-Job changes needed for Phase A.**

**Validation gate:** Run for 1 week. If Queue click-through rate < 30% of advisor actions, revisit advisor quality before proceeding. If > 30%, continue to Phase A.5.

---

### Phase A.5 — Agent ROI & Accuracy Tracking (1-2 days)

**Build this before MCP, webhooks, or skill routing.** You cannot safely increase automation without knowing whether the system is trustworthy.

**RepoHQ changes:**
- Webhook endpoint: `src/app/api/webhooks/agent-events/route.ts`
  - Accepts `POST` with `{ eventType, taskId, repoId, prUrl, summary, merged }`
  - On `agent_pr_merged`: triggers repo resync via `after()` → computes `actualDelta` (health score before/after)
  - Stores `{ predictedDelta, actualDelta, costUsd, durationMs, filesChanged, merged }` in `portfolio_events` metadata
- New page: `/agent-performance`
  - Tasks executed, success rate, merged rate
  - Advisor accuracy: predicted vs actual delta (rolling average)
  - Portfolio score gained from agent work
  - Estimated hours saved
  - Cost per task

**AI-Took-My-Job changes:**
- In merge/PR handlers: fire RepoHQ webhook with outcome
- Pass `durationMs`, `filesChanged` in webhook payload

**Unlock criterion for Phase B:** Advisor accuracy ≥ 70% over at least 10 tasks.

---

### Phase B — MCP Context Bridge (1 day)

When the Nexus agent starts, it reads `get_coding_brief` from RepoHQ MCP. Every agent session is context-aware without you explaining anything.

This is the secret sauce. Most coding agents get: *repo + task + go.* Your agents get:

```json
{
  "health": 62,
  "opportunity": 88,
  "purpose": "Revenue",
  "focused": true,
  "goal": "Reach $500 MRR",
  "techDebt": "High",
  "recentSessions": [
    { "agent": "Claude Code", "summary": "Attempted Stripe integration", "date": "2026-05-14" },
    { "agent": "Claude Code", "summary": "Attempted Stripe integration again, abandoned", "date": "2026-05-28" }
  ],
  "securityAlerts": 2,
  "advisorAction": "Fix missing README sections"
}
```

That `recentSessions` field — institutional memory — is what makes agents smarter over time. An agent that sees "Attempted Stripe integration twice, both abandoned" won't try a third time without asking why.

**AI-Took-My-Job changes:**
- In `src/services/agent-tasks/agent-runner.ts`: before writing `.nexus/context.json`, call RepoHQ MCP `get_coding_brief(repoName)` and merge result into context
- New env vars: `REPOHQ_MCP_PATH`, `REPOHQ_MCP_USER_ID`, `REPOHQ_DB_URL`

**RepoHQ MCP already works** — no changes needed. Expand `get_coding_brief` to include richer institutional context (recent failures, goal context, revenue sensitivity).

**Verification:** Inspect `.nexus/context.json` during an execution — should contain health, tech debt, recent sessions, current goal.

---

### Phase C — gstack Skill Routing (1-2 days)

Map task types to gstack skills as `AGENT_EXECUTION_COMMAND`, ordered by risk tier.

**Risk-based routing (NOT task-type-based):**
- **Tier 1 / docs** → direct Claude prompt (no gstack, lowest blast radius)
- **Tier 2 / deps** → gstack `/ship` skill wrapper
- **Tier 2 / CI** → gstack `/investigate` + `/ship` wrapper
- **Tier 3 / security** → gstack `/investigate` skill (only after Tier 1-2 proven safe)

**AI-Took-My-Job changes:**
- In agent-runner: read `taskRiskTier` from metadata, resolve command accordingly
- New scripts: `scripts/gstack-ship.sh`, `scripts/gstack-investigate.sh` — each writes `.nexus/output.json` in contract format

**Verification:** Queue a docs task → direct Claude runs → output.json valid. Queue a dep task → `/ship` runs → output.json valid.

---

### Phase D — Webhook Depth & Portfolio Events (1 day)

Enrich the webhook loop with richer outcome data feeding back into RepoHQ's portfolio view.

**Already partially built in Phase A.5.** This phase adds:
- `agent_pr_created` event type with PR URL stored in `portfolio_events`
- Advisor card shows PR status badge (queued → running → PR open → merged)
- Feed page shows "Agent fixed security alert in repo X" as a timeline event
- Graveyard integration: if agent archives a repo, write abandonment reason automatically

---

### Phase E — Intelligent Routing & Batch Approval (unlock after 6+ months of data)

**Do not build this until you have:**
- Advisor accuracy ≥ 80% over 50+ tasks
- Agent success rate ≥ 80% over 50+ executions
- 3+ months of portfolio score data showing upward trend from agent work

Auto-queuing before these thresholds is automating blindly. Keep the human approval gate until the numbers justify removing it.

**When ready:**
- Auto-queue `effort: 'quick'` Tier 1 tasks without button click
- Batch approval UX for reviewing 5-10 low-risk tasks at once
- Confidence threshold setting in Settings → Agent Automation

---

## Roadmap Entry

**Phase 46 — RepoHQ × AI-DevOps Nexus Integration**
- [ ] Phase A: "Queue" button on advisor actions → POST to Nexus (1-week validation gate)
- [ ] Phase A.5: Agent ROI tracking — accuracy, cost, delta, `/agent-performance` page
- [ ] Phase B: Nexus agent reads `get_coding_brief` via RepoHQ MCP (unlock at 70% accuracy)
- [ ] Phase C: gstack skills as `AGENT_EXECUTION_COMMAND` per risk tier
- [ ] Phase D: Webhook depth — PR status badges, feed events, portfolio integration
- [ ] Phase E: Auto-queue + batch approval (unlock after 6 months + 80% accuracy)

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Advisor accuracy too low | Track `predictedDelta` vs `actualDelta` from Day 1; Phase gates prevent advancing until ≥70% |
| Agent context loss (70%+ capacity) | Keep coding brief under 2000 tokens; one action per execution |
| Security fix introduces new vulnerability | Security in Tier 3 — only after Tier 1-2 proven safe over 20+ executions |
| Approval bottleneck | Batch approval in Phase E; not before accuracy is proven |
| Nexus API auth leak | Service token stored in RepoHQ env vars only, never in DB |
| PR created without user knowledge | All PRs default `draft: true`; no force-merge path |
| Auto-queue causing unreviewed work | Phase E gated behind hard accuracy/volume thresholds |
| gstack skill incompatibility | Each wrapper tested against `.nexus/output.json` contract in isolation before routing |

---

## Success Metrics

| Metric | Target | When Measured |
|--------|--------|--------------|
| Queue click-through rate | > 30% of advisor actions | End of Phase A week |
| Advisor accuracy | > 70% (predicted vs actual delta) | Gate for Phase B |
| Advisor accuracy | > 80% | Gate for Phase E |
| Agent execution success rate | > 80% | Ongoing from Phase A.5 |
| PR merged rate | > 75% | Ongoing from Phase A.5 |
| Portfolio score gained from agents | Measurable upward trend | After 2 weeks |
| Zero production incidents | 100% | Always (draft PRs enforce this) |
| Loop closure rate (`log_session_complete`) | 100% | Always |

---

## Files to Create/Modify

**RepoHQ:**
- NEW: `src/lib/actions/nexus.ts` — `queueAdvisorAction()`, `getNexusTaskStatus()`
- NEW: `src/app/api/webhooks/agent-events/route.ts` — inbound webhook + accuracy computation
- NEW: `src/app/(app)/agent-performance/page.tsx` — ROI dashboard
- MOD: `src/components/dashboard/advisor-card.tsx` — Queue button, PR status badge
- MOD: `src/app/(app)/settings/page.tsx` — Nexus connection section
- MOD: `src/lib/db/schema.ts` — extend `portfolio_events.metadata` for accuracy fields
- MOD: `.env.example` — add `NEXUS_API_URL`, `NEXUS_API_TOKEN`, `NEXUS_WEBHOOK_SECRET`

**AI-Took-My-Job:**
- MOD: `src/services/agent-tasks/agent-runner.ts` — inject `get_coding_brief` context
- MOD: `src/services/agent-tasks/pull-request-promotion.ts` — fire RepoHQ webhook with outcome
- NEW: `scripts/gstack-investigate.sh`, `scripts/gstack-ship.sh` — skill wrappers
- MOD: `.env` / config — `REPOHQ_MCP_PATH`, `REPOHQ_WEBHOOK_URL`, `REPOHQ_WEBHOOK_SECRET`
