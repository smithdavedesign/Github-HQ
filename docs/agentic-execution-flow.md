# Agentic Execution Flow — Quick Reference

Quick reference for the execution pipeline. For full diagrams and sequences, see [agentic-full-flow.md](agentic-full-flow.md).

---

## Pipeline Overview

```
User / Cron / MCP agent
        │
        ▼ POST /internal/agent-tasks
┌────────────────────────────────────────┐
│  AI-Took-My-Job / Nexus               │
│  ┌─────────────────────────────────┐   │
│  │ BullMQ Worker                   │   │
│  │  1. MCP get_coding_brief()      │   │
│  │  2. Route by skillName          │   │
│  │  3. OPENCLAW_SESSION=true       │   │
│  │  4. Inject CLAUDE.md brief      │   │
│  │  5. Load gstack learnings       │   │
│  │  6. Run claude /[skill]         │   │
│  └─────────────────────────────────┘   │
│           │                            │
│           ▼ webhook POST               │
└────────────────────────────────────────┘
        │
        ▼ /api/webhooks/agent-events
┌────────────────────────────────────────┐
│  RepoHQ                                │
│  • Correlate taskId → userId + repoId  │
│  • Write portfolio_events              │
│  • Dispatch notification (after())     │
│  • Re-sync repo (agent_pr_merged)      │
└────────────────────────────────────────┘
```

---

## Skill Routing

`skillName` in the Nexus `contextNotes` JSON determines which gstack script runs:

| skillName | executionMode | What it does |
|-----------|--------------|-------------|
| `investigate` | investigate | Diagnose root cause, fix if safe |
| `review` | investigate | Code review — findings only, no changes |
| `qa-only` | investigate | Bug hunt — report only |
| `qa` | fix | Find + fix bugs with atomic commits |
| `ship` | fix | Implement objective, run tests, open PR |
| `document-release` | fix | Update README, docs, CHANGELOG |
| `health` | investigate | Code quality score — TypeScript, tests, dead code |
| `canary` | investigate | Live app check — console errors, performance |
| `retro` | investigate | Weekly commit analysis |

---

## Lifecycle States

```
idle
  └─► queued        (task POSTed to Nexus)
        └─► preparing     (Nexus worker starts, reading brief)
              └─► running       (gstack skill executing)
                    ├─► pr_ready      (agent opened a PR)   ──► merged ✓
                    │                                         └─► (closed)
                    ├─► report_ready  (skill report with findings, no PR)
                    ├─► failed ✓      (agent errored)
                    ├─► timed_out ✓   (execution exceeded timeout)
                    └─► needs_human ✓ (escalated after retries)
```

Terminal states: `merged`, `failed`, `timed_out`, `needs_human`. A repo in a terminal state is safe to re-queue.

---

## Entry Points

Three ways to queue a skill:

| Entry point | Server action | Source field |
|-------------|--------------|-------------|
| Repo Agent tab → Run Agent (advisor) | `queueAdvisorAction()` | `source: 'repohq-advisor'` |
| Repo Agent tab → gstack Skill Launcher | `queueGstackSkill()` | `source: 'repohq-gstack-ui'` |
| MCP `queue_gstack_skill` tool | Direct Nexus POST in `mcp/server.ts` | `source: 'repohq-mcp-agent'` |
| Monday cron (auto-dispatch) | `queueAdvisorActionForUser()` | `source: 'repohq-auto-dispatch'`, `autoDispatched: true` |

All entry points:
- Check `BLOCKING_STAGES` before posting (lifecycle guard — prevents duplicates)
- Write an `agent_task_queued` portfolio_event with `taskId` for webhook correlation
- Return `{ taskId, nexusUrl }` for UI polling

---

## Webhook Correlation

Nexus fires webhooks to `/api/webhooks/agent-events`. The handler:

1. Validates `x-nexus-webhook-secret` header
2. Scans last 50 `agent_task_queued` events for matching `taskId`
3. If matched: extracts `userId` + `repoId` + `predictedDelta` + `impactType`
4. Writes the event and dispatches notifications

If `taskId` is not found in the last 50 events, the webhook is accepted but logged as uncorrelated (accuracy tracking skipped).

---

## Accuracy Tracking

Accuracy is computed on-the-fly from `portfolio_events` — no separate table:

```
agent_pr_merged event  →  actualDeltaPending: true initially
        │
        ▼ after syncSingleRepo() completes
resolveActualDeltas()  →  actualDelta = healthAfter - healthBefore
                          deltaConfidence = 'high' | 'low'

get_accuracy_report / advisor prompt:
  impactType × successRate × avgActualDelta
  time-decayed: last 30d weighted 2×
  min data points: security=5, health=3, opportunity=3, revenue=8
```

---

## UI Polling

The skill launcher polls `/api/agent-task-status?taskId=...` every 5 seconds while a skill is `queued` or `running`. Status transitions update badge states in real time. On `report_ready`, `previewFindings` (first 2 findings) are returned for the inline preview.

---

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `NEXUS_API_URL` | For agent features | Nexus base URL |
| `NEXUS_API_TOKEN` | For agent features | Service-to-service auth |
| `NEXUS_WEBHOOK_SECRET` | For agent features | Webhook signature validation |
