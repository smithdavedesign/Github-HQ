# RepoHQ × AI-Took-My-Job — Agentic Portfolio Execution PRD

## Context

RepoHQ is a portfolio intelligence layer that generates quantified, prioritised action recommendations ("deploy repo X for +14 opportunity points", "fix 2 security alerts in repo Y"). AI-Took-My-Job (AI-DevOps Nexus) is a feedback-to-engineering control plane with a review-gated queue, BullMQ async workers, and a contract-based Claude agent execution pipeline that clones repos, creates isolated branches, runs an agent, and promotes changes as PRs.

The integration closes the loop RepoHQ can't close alone: **insight → execution**. The advisor tells you what to do; the agent does it.

This is not wild. It is timely. The competitive research confirms the combination (portfolio scoring + agent execution) is genuinely novel — most tools are one or the other. The human approval gate is the right architectural call for 2026. The risk is scope creep: agents fail on production repos at 20-30% when given open-ended briefs. The fix is narrow task types and honest scoring.

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
3. Approval bottleneck → batch low-risk changes, score-based auto-approve threshold
4. Multi-agent coordination gaps → sequential, not parallel, execution per repo

---

## Scope — Task Types IN (Phase 1-2)

Only high-confidence, testable, narrow-scope tasks:
- **Dependency updates** (Dependabot-style, clear test criteria, low blast radius)
- **Security alert fixes** (known CVEs, package bumps, alert dismissal with evidence)
- **Missing documentation** (README gaps identified by health scorer, docs-only changes)

**NOT in scope (yet):**
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
       │     acceptanceCriteria }
       └──────────────────────────────→ Review Queue
                                             │ (human approves)
       ←─── taskId stored in            Worker prepares context
            portfolio_events ──────────→      │
                                        Agent reads
                                        get_coding_brief ←── RepoHQ MCP
                                              │
                                        Isolated branch
                                        Code changes
                                        .nexus/output.json
                                              │
                                        PR created
                                              │
                                        Webhook → RepoHQ
       ←─── portfolio_events ────────── 'agent_pr_created'
            updated
                                        (human merges)
                                              │
                                        Webhook → RepoHQ
       ←─── health resync ─────────────  'agent_pr_merged'
```

**Key integration points:**

- **RepoHQ → AI-Took-My-Job:** `POST /internal/agent-tasks` with `objective` from `AdvisorAction.action` + `AdvisorAction.reasoning`, `targetRepository` from repo `fullName`, `acceptanceCriteria` generated from `impactType`
- **AI-Took-My-Job agent → RepoHQ MCP:** calls `get_coding_brief(repo_name)` to populate `.nexus/context.json`
- **AI-Took-My-Job → RepoHQ:** webhook `POST /api/webhooks/agent-events` (new endpoint) writes `portfolio_events`
- **gstack as AGENT_EXECUTION_COMMAND:** configure gstack skills per task type (security → `/investigate`, deps → `/ship`, docs → direct Claude)

---

## User Journey (Target State)

1. RepoHQ advisor card shows: "Deploy repo X — +14 opp points [Queue →]"
2. User clicks "Queue" → task appears in AI-Took-My-Job review queue with full context
3. User reviews in Nexus queue: sees objective, repo, acceptance criteria, RepoHQ context brief
4. User approves → worker prepares context → agent reads `get_coding_brief` via MCP
5. Agent executes on isolated branch, writes `.nexus/output.json`
6. Validation runs (tests pass?)
7. Nexus shows diff + output to user → user approves → PR created
8. User merges PR in GitHub
9. RepoHQ webhook triggers → `portfolio_events` records `agent_pr_merged` → health resync scheduled
10. Next advisor run shows updated scores, marks action complete

---

## Implementation Phases

### Phase A — The Bridge (1-2 days, highest ROI)

Add "Queue" button to RepoHQ advisor actions. Calls AI-Took-My-Job API.

**RepoHQ changes:**
- New env var: `NEXUS_API_URL`, `NEXUS_API_TOKEN`
- New server action: `src/lib/actions/nexus.ts` → `queueAdvisorAction(advisorAction)`
  - Maps `AdvisorAction` → `POST /internal/agent-tasks` payload
  - Stores returned `taskId` in `portfolio_events` (eventType: `'agent_task_queued'`, metadata: `{ taskId, nexusStatus }`)
- New UI: `QueueButton` on advisor card items (shows spinner while queuing, task ID badge when queued)
- New settings field: Nexus connection (URL + token)

**No AI-Took-My-Job changes needed for Phase A.**

Verification: Click Queue on advisor card → check AI-Took-My-Job review queue shows item with correct repo + objective.

---

### Phase B — MCP Context Bridge (1 day)

When Nexus agent starts, it reads `get_coding_brief` from RepoHQ MCP. Makes every agent session context-aware automatically.

**AI-Took-My-Job changes:**
- In `src/services/agent-tasks/agent-runner.ts`: before writing `.nexus/context.json`, call RepoHQ MCP `get_coding_brief(repoName)` and merge into context
- Add env vars: `REPOHQ_MCP_PATH`, `REPOHQ_MCP_USER_ID`, `REPOHQ_DB_URL`

**RepoHQ MCP already works** — no changes needed.

Verification: Start an execution, inspect `.nexus/context.json` — should contain health score, tech debt, recent sessions.

---

### Phase C — Webhook Loop (1 day)

AI-Took-My-Job calls back to RepoHQ when PRs are created and merged. Closes the feedback loop.

**RepoHQ changes:**
- New API route: `src/app/api/webhooks/agent-events/route.ts`
  - Accepts `POST` with `{ eventType, taskId, repoId, prUrl, summary }`
  - Validates token (`NEXUS_WEBHOOK_SECRET`)
  - Writes `portfolio_events` entry
  - If `agent_pr_merged`: triggers a repo resync via `after()` → `syncSingleRepo`

**AI-Took-My-Job changes:**
- In `pull-request-promotion.ts`: after PR created → call RepoHQ webhook
- In merge handler: after merge confirmed → call RepoHQ webhook
- New env vars: `REPOHQ_WEBHOOK_URL`, `REPOHQ_WEBHOOK_SECRET`

Verification: Create and merge a test PR via Nexus → RepoHQ `portfolio_events` shows entry → repo health score updates.

---

### Phase D — gstack Skill Routing (1-2 days)

Map task types to specific gstack skills as `AGENT_EXECUTION_COMMAND`. Gives each task type a purpose-built agent behaviour.

**AI-Took-My-Job changes:**
- In agent-runner or task preparation: read `taskType` from metadata
- Resolve `AGENT_EXECUTION_COMMAND` by task type:
  - `security_fix` → gstack `/investigate` skill wrapper
  - `dependency_update` → gstack `/ship` skill wrapper
  - `documentation` → direct Claude prompt (no gstack)
- Each wrapper writes the `AGENT_EXECUTION_COMMAND`-compatible `.nexus/output.json`

**gstack wrappers (new scripts):**
- `scripts/gstack-investigate.sh` — runs `/investigate` skill, captures findings, writes output.json
- `scripts/gstack-ship.sh` — runs `/ship` skill, captures PR metadata, writes output.json

Verification: Queue a security-type action → verify `/investigate` skill runs → output.json has correct shape.

---

### Phase E — Intelligent Routing & Batch Approval (2-3 days, ambitious)

Score-based auto-queue for high-confidence changes. Batch approval UX.

**RepoHQ changes:**
- Auto-queue logic: if `AdvisorAction.effort === 'quick'` and `impactType === 'security'` → auto-queue without button click (configurable threshold in Settings)
- Settings page: "Agent Automation" section — enable/disable auto-queue, set confidence threshold, allowed task types

**AI-Took-My-Job changes:**
- Batch approval endpoint: `POST /internal/agent-tasks/batch-approve` for reviewing multiple low-risk tasks at once
- Confidence score field on tasks (passed from RepoHQ)

Verification: Security alert queues automatically → appears in Nexus for batch approval.

---

## Roadmap

**Phase 46 — RepoHQ × AI-DevOps Nexus Integration**
- [ ] Phase A: "Queue" button on advisor actions → POST to Nexus `/internal/agent-tasks`
- [ ] Phase B: Nexus agent reads `get_coding_brief` via RepoHQ MCP before execution
- [ ] Phase C: Nexus webhook → RepoHQ on PR created/merged → `portfolio_events` + auto-resync
- [ ] Phase D: gstack skills as `AGENT_EXECUTION_COMMAND` per task type
- [ ] Phase E: Score-based auto-queue, batch approval UX

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Agent context loss (70%+ capacity) | Keep coding brief under 2000 tokens; one action per execution |
| False-positive advisor recommendations | Limit Phase A to security + dependency task types only |
| Approval bottleneck | Batch approval UX in Phase E; auto-approve `effort: 'quick'` below threshold |
| Nexus API auth | Service token with `internal:read` scope; stored in RepoHQ env, never in DB |
| PR creates without user knowledge | Gate: all PRs create as `draft: true` by default |
| Health scores diverge from reality | Webhook-triggered resync after every merged PR |
| gstack skill incompatibility | Test each skill wrapper against `.nexus/output.json` contract in isolation |

---

## Success Metrics

- Advisor action → PR merged in < 30 min (excluding human review time)
- Agent execution success rate ≥ 80% on in-scope task types
- Portfolio health score improves measurably within 2 weeks of enabling
- Zero production incidents from agent-generated changes (draft PRs prevent this)
- `log_session_complete` called for every execution (loop closure rate 100%)

---

## Files to Create/Modify

**RepoHQ:**
- NEW: `src/lib/actions/nexus.ts` — `queueAdvisorAction()`, `getNexusTaskStatus()`
- NEW: `src/app/api/webhooks/agent-events/route.ts` — inbound webhook handler
- MOD: `src/components/dashboard/advisor-card.tsx` — add Queue button per action
- MOD: `src/app/(app)/settings/page.tsx` — Nexus connection settings section
- MOD: `.env.example` — add `NEXUS_API_URL`, `NEXUS_API_TOKEN`, `NEXUS_WEBHOOK_SECRET`

**AI-Took-My-Job:**
- MOD: `src/services/agent-tasks/agent-runner.ts` — inject `get_coding_brief` context
- MOD: `src/services/agent-tasks/pull-request-promotion.ts` — fire RepoHQ webhook
- NEW: `scripts/gstack-investigate.sh`, `scripts/gstack-ship.sh` — skill wrappers
- MOD: `.env` / config — `REPOHQ_MCP_PATH`, `REPOHQ_WEBHOOK_URL`, `REPOHQ_WEBHOOK_SECRET`
