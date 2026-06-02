# RepoHQ — Full Agentic Flow (Phases 46–54)

Complete visual reference for the automated portfolio improvement pipeline as of Phase 54.

---

## End-to-End System Architecture

```mermaid
graph TB
    subgraph RepoHQ["RepoHQ (Intelligence Layer)"]
        direction TB
        GH[GitHub Sync\nevery 6h]
        SCORE[Health Scoring Engine\nactivity · security · docs · build]
        ADVISOR[AI Advisor\nquantified actions + predicted delta]
        DASH[Dashboard\nAdvisorCard + QueueButton]
        DB[(Neon PostgreSQL\nrepositories · portfolio_events\nnotifications · health_score_history)]

        subgraph MCP["MCP Server (Agent Context)"]
            MB1[get_coding_brief\nhealth · in-flight · attempts]
            MB2[get_next_action\nskips open PRs + dead ends]
            MB3[log_attempt\noutcome feedback]
            MB4[log_session_complete]
            MB5[get_active_work\ncollision prevention]
        end

        subgraph NOTIFY["Push Notifications (Phase 49)"]
            BELL[In-app Bell\nunread badge + sheet]
            HOOK_OUT[Webhook Dispatcher\nSlack · Zapier · custom]
            HEALTH_ALERT[Health Threshold Alerts\nper-user threshold in Settings]
        end

        subgraph OBSERVE["Observability (Phase 47–48)"]
            PERF[Agent Performance Page\n/agent-performance]
            FEED[Portfolio Feed\nagent events inline]
            BADGE[Repo List PR badge\nopen → GitHub link]
            HISTORY[Repo Detail Agent tab\nattempts · PRs · actual delta]
        end

        MERGE[PR Merge Detector\ncheckMergedAgentPRs]
        DELTA[Delta Resolver\nresolveActualDeltas]
        HOOK_IN[Webhook Handler\n/api/webhooks/agent-events]
    end

    subgraph Nexus["AI-Took-My-Job / Nexus (Execution Layer)"]
        direction TB
        API[Internal API\n/internal/agent-tasks]
        WORKER[BullMQ Worker\nauto-execute pipeline]
        AGENT[Claude Agent\nisolated branch]
        VALID[Validation\ntests pass?]
        PROMOTE[PR Promotion\ndraft:false]
    end

    GH -->|repos + metrics| SCORE
    SCORE -->|health scores| ADVISOR
    ADVISOR -->|top actions| DASH
    DASH -->|"Run Agent"| API
    API -->|taskId| DB
    API --> WORKER
    WORKER -->|get_coding_brief| MB1
    MB1 -->|context| AGENT
    AGENT -->|changes| VALID
    VALID -->|pass| PROMOTE
    PROMOTE -->|agent_pr_created webhook| HOOK_IN
    HOOK_IN -->|write event| DB
    HOOK_IN -->|"agent_pr_ready notification"| HOOK_OUT
    HOOK_IN -->|after()| MERGE
    MERGE -->|healthBefore| DB
    GH -->|resync| DELTA
    DELTA -->|actualDelta patch| DB
    DELTA -->|agent_pr_merged event| PERF
    WORKER -->|agent_failed webhook| HOOK_IN
    HOOK_IN -->|"agent_failed notification"| HOOK_OUT
    HOOK_OUT --> BELL
    HOOK_OUT -->|POST| SLACK[Slack / Zapier]
    GH -->|after sync| HEALTH_ALERT
    HEALTH_ALERT -->|health_alert| BELL
    AGENT -->|log_attempt| MB3
    MB3 -->|agent_attempt event| DB
    DB -->|attempt history| MB1
    MB2 -->|skip repos with open PRs| ADVISOR
    MB2 -->|skip dead ends| ADVISOR
    DB --> FEED
    DB --> BADGE
    DB --> HISTORY
    DB --> PERF
```

---

## Automated Execution Sequence (Happy Path)

```mermaid
sequenceDiagram
    actor Human
    participant RepoHQ
    participant MCP
    participant Nexus
    participant GitHub

    Human->>RepoHQ: Views dashboard
    RepoHQ->>RepoHQ: Advisor generates "Fix security alert (+12 pts)"
    Human->>RepoHQ: Clicks "Run Agent" (effort: quick)
    RepoHQ->>Nexus: POST /internal/agent-tasks {autoExecute:true}
    Nexus-->>RepoHQ: {taskId}
    RepoHQ->>RepoHQ: Writes agent_task_queued event
    Note over RepoHQ: QueueButton shows "Queued → Preparing…"

    Nexus->>MCP: get_coding_brief("repo-name")
    MCP-->>Nexus: health 62/100 · no open PRs · 0 recent failures
    Nexus->>GitHub: clone repo, create branch
    Nexus->>Nexus: Claude agent executes fix
    Nexus->>MCP: log_attempt("repo", "fix CVE-2024-x", "success")
    MCP->>RepoHQ: Writes agent_attempt event
    Nexus->>GitHub: push branch, create PR
    Nexus->>RepoHQ: POST /webhooks/agent-events {agent_pr_created}
    RepoHQ->>RepoHQ: Writes agent_pr_created event
    RepoHQ->>RepoHQ: Dispatches agent_pr_ready notification
    Note over RepoHQ: QueueButton shows "PR Ready →"
    Note over Human: Bell shows unread badge

    Human->>GitHub: Reviews + merges PR
    Note over RepoHQ: checkMergedAgentPRs() detects merge in next cron
    RepoHQ->>RepoHQ: Writes agent_pr_merged event (healthBefore captured)
    RepoHQ->>GitHub: syncSingleRepo()
    RepoHQ->>RepoHQ: resolveActualDeltas(): actualDelta = +9 pts
    Note over RepoHQ: Agent Performance shows predicted +12, actual +9 (75% accuracy)
```

---

## Dead-End Detection & Feedback Loop (Phase 51)

```mermaid
flowchart LR
    A[Agent attempts action] --> B{Outcome?}
    B -->|success| C[log_attempt: success\nNo feedback effect]
    B -->|failed| D[log_attempt: failed\nWrites agent_attempt event]
    D --> E{2+ failures\nfor same repo+action?}
    E -->|No| F[Next get_next_action\nnormal priority]
    E -->|Yes| G[getDeadEndActions\nflags this combo]
    G --> H[get_next_action skips it\nAdvisor picks next-best]
    G --> I[get_coding_brief shows\n⚠ failure warning]
    H --> J[Human sees different\naction recommended]
```

---

## Notification Flow (Phase 49)

```mermaid
flowchart TD
    A([Event occurs]) --> B{Event type}

    B -->|Health crosses threshold\nat end of 6h sync| C[checkHealthThresholdAlerts\n7-day no-spam window]
    B -->|Agent PR created| D[Webhook handler\nafter POST from Nexus]
    B -->|Agent execution failed| E[Webhook handler\nafter POST from Nexus]

    C --> F[Insert notification\nheal_alert]
    D --> G[Insert notification\nagent_pr_ready]
    E --> H[Insert notification\nagent_failed]

    F & G & H --> I{webhookUrl\nconfigured?}
    I -->|Yes| J[POST to\nwebhookUrl]
    I -->|No| K[In-app only]
    J --> L[Slack / Zapier / custom]
    K --> M[Bell badge increments]
    L --> M
    M --> N[Human clicks bell\nSees notification panel]
    N --> O[Mark as read]
```

---

## MCP Tool Summary (Phase 45–51)

| Tool | Phase | Purpose |
|------|-------|---------|
| `get_portfolio_summary` | 45 | Overview: score, focused repos, top advisor actions |
| `get_repo_context` | 45 | Deep context for a specific repo |
| `get_portfolio_warnings` | 45 | Failing builds, security alerts, health drops |
| `get_top_opportunities` | 45 | Repos by opportunity score |
| `get_active_goals` | 45 | Goals with progress |
| `get_coding_brief` | 45–51 | Full session-start doc: health, in-flight, attempts, sessions |
| `get_next_action` | 45–51 | Top ROI action; skips open PRs + dead ends |
| `log_session_complete` | 45 | Records what was done (human-authored session note) |
| `get_active_work` | 50 | Open agent PRs per repo or portfolio-wide; safe-to-start flag |
| `log_attempt` | 51 | Records attempt outcome; feeds dead-end detection |

---

## Auto-Dispatch Flow (Phase 53 — Monday Morning PRs)

```mermaid
sequenceDiagram
    participant Cron as Monday Cron
    participant Advisor as generateAdvisor()
    participant Dispatch as autoDispatchAdvisorActions()
    participant Guard as Lifecycle Guard
    participant Nexus as AI-Took-My-Job
    participant Human as Developer

    Cron->>Advisor: Generate top 5 recommendations
    Advisor-->>Cron: AdvisorContent (5 actions)
    Cron->>Dispatch: if autoDispatchEnabled
    
    loop For each action (up to maxPerRun)
        Dispatch->>Dispatch: Effort gate check (quick/medium/all)
        Dispatch->>Dispatch: Security gate (skip if enabled)
        Dispatch->>Dispatch: Accuracy gate (min success rate)
        Dispatch->>Guard: getRepoLifecycle(userId, repoId)
        Guard-->>Dispatch: stage (idle/queued/running/pr_ready/...)
        alt stage is BLOCKING
            Dispatch->>Dispatch: skip (task already in flight)
        else stage is idle/terminal
            Dispatch->>Nexus: queueAdvisorActionForUser()
            Nexus-->>Dispatch: { taskId }
            Dispatch->>Dispatch: write agent_task_queued event (autoDispatched: true)
        end
    end

    Note over Human: Monday morning
    Human->>Human: Notification bell shows N new PRs
    Human->>Human: Reviews each PR
    Human->>Human: Merges good ones, closes bad ones
```

## Token Efficiency (Phase 54)

```mermaid
flowchart LR
    subgraph Before["Before Phase 54 (per agent call)"]
        A1[7-8 DB queries] --> B1[277 tokens fresh]
        A2[Recompute repo deltas] --> B2[2550 tokens rebuilt]
    end
    
    subgraph After["After Phase 54 (per agent call)"]
        C1{cached_brief\nfresh < 6h?} -->|Yes| D1[1 DB read\n0 compute]
        C1 -->|No - stale/missing| D2[7-8 DB queries\nwrite to cache]
        C2{advisorRepoSnapshot\nfresh < 23h?} -->|Yes| D3[Reuse repoLines\n0 tokens]
        C2 -->|No - sync cleared it| D4[Recompute + store]
    end
    
    E[Sync completes] --> F[Clear cached_brief\nClear advisorRepoSnapshot]
    F --> G[Next call regenerates fresh]
```

## MCP Tool Summary (Phase 45–54)

| Tool | Phase | Purpose |
|------|-------|---------|
| `get_portfolio_summary` | 45 | Overview: score, focused repos, top advisor actions |
| `get_repo_context` | 45 | Deep context for a specific repo |
| `get_portfolio_warnings` | 45 | Failing builds, security alerts, health drops |
| `get_top_opportunities` | 45 | Repos by opportunity score |
| `get_active_goals` | 45 | Goals with progress |
| `get_coding_brief` | 45–54 | Full session-start doc; served from cache within 6h |
| `get_next_action` | 45–54 | Top ROI action; skips open PRs + dead ends; confidence line |
| `log_session_complete` | 45 | Records what was done |
| `get_active_work` | 50 | Open agent PRs; safe-to-start flag |
| `log_attempt` | 51 | Records attempt outcome; feeds dead-end detection |
| `get_accuracy_report` | 52 | Advisor calibration table + downgraded repos |
