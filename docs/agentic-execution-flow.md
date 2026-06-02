# Agentic Execution Flow — RepoHQ × AI-Took-My-Job

Visual reference for the architecture and user flows in Phase 46.

---

## System Architecture

```mermaid
graph TB
    subgraph RepoHQ["RepoHQ (Intelligence Layer)"]
        GH[GitHub Sync]
        SCORE[Health / Opportunity\nScoring Engine]
        ADVISOR[AI Advisor\nTop 5 Quantified Actions]
        SIM[Simulation Engine\nPlan My Week]
        DASH[Dashboard\n+ Advisor Card]
        MCP[MCP Server\nget_coding_brief\nget_next_action\nlog_session_complete]
        PERF[Agent Performance\nPage]
        DB[(Neon PostgreSQL\nportfolio_events\nhealth_score_history)]
        HOOK[Webhook Handler\n/api/webhooks/agent-events]
    end

    subgraph Nexus["AI-Took-My-Job / Nexus (Execution Layer)"]
        QUEUE[Review Queue\nOperator UI]
        WORKER[BullMQ Worker]
        AGENT[Claude Agent\nisolated branch]
        VALID[Validation\nnpm test / replay]
        PR[GitHub PR\ndraft by default]
    end

    subgraph Inputs["Input Channels"]
        EXT[Chrome Extension\nUser bug reports]
        RBTN[Queue Button\nAdvisor actions]
    end

    subgraph gstack["gstack Skills"]
        INV[/investigate]
        SHIP[/ship]
    end

    GH --> SCORE --> ADVISOR --> DASH
    DASH --> RBTN
    RBTN -->|POST /internal/agent-tasks\npredictedDelta| QUEUE
    EXT -->|POST /webhooks/extension| QUEUE

    QUEUE -->|human approves| WORKER
    WORKER -->|reads context| MCP
    MCP -->|get_coding_brief| WORKER
    WORKER --> AGENT

    AGENT --> INV
    AGENT --> SHIP
    AGENT --> VALID
    VALID --> PR

    PR -->|merged| HOOK
    HOOK -->|actualDelta computed| DB
    HOOK -->|accuracy logged| PERF
    HOOK -->|resync triggered| GH

    MCP --> DB
    AGENT -->|log_session_complete| MCP

    style RepoHQ fill:#1e1b4b,stroke:#6366f1,color:#e0e7ff
    style Nexus fill:#1a2744,stroke:#3b82f6,color:#dbeafe
    style Inputs fill:#1a2e1a,stroke:#22c55e,color:#dcfce7
    style gstack fill:#2d1a1a,stroke:#f59e0b,color:#fef3c7
```

---

## User Flow — Phase A (The Bridge)

```mermaid
sequenceDiagram
    actor User
    participant RepoHQ
    participant Nexus as AI-Took-My-Job
    participant GitHub

    RepoHQ->>RepoHQ: Daily sync + scoring
    RepoHQ->>RepoHQ: Advisor generates top 5 actions
    User->>RepoHQ: Views dashboard advisor card
    User->>RepoHQ: Clicks "Queue →" on an action

    RepoHQ->>Nexus: POST /internal/agent-tasks<br/>{ objective, repo, acceptanceCriteria, predictedDelta }
    Nexus-->>RepoHQ: 202 Accepted { taskId }
    RepoHQ->>RepoHQ: Stores taskId in portfolio_events
    RepoHQ-->>User: Badge "Queued ✓" on advisor action

    User->>Nexus: Reviews task in Nexus queue
    Note over User,Nexus: Sees objective, repo, RepoHQ context brief
    User->>Nexus: Approves task

    Nexus->>Nexus: Worker prepares context
    Nexus->>RepoHQ: MCP get_coding_brief(repoName)
    RepoHQ-->>Nexus: Health, tech debt, recent sessions,<br/>goals, recent failures
    Nexus->>Nexus: Writes .nexus/context.json

    Nexus->>Nexus: Agent executes on isolated branch
    Nexus->>Nexus: Validation runs (tests)
    User->>Nexus: Reviews diff + output
    User->>Nexus: Approves → PR created (draft)

    User->>GitHub: Merges PR
    GitHub-->>Nexus: Merge confirmed

    Nexus->>RepoHQ: POST /api/webhooks/agent-events<br/>{ agent_pr_merged, taskId, prUrl }
    RepoHQ->>RepoHQ: Triggers repo resync
    RepoHQ->>RepoHQ: Computes actualDelta
    RepoHQ->>RepoHQ: Logs accuracy: predicted vs actual
    RepoHQ-->>User: Agent Performance page updated
```

---

## Phase A.5 — Accuracy Feedback Loop

```mermaid
flowchart LR
    A[Advisor generates action\npredictedDelta: +14 opp pts] 
    --> B[User queues task\npredictedDelta stored]
    --> C[Agent executes\nPR created + merged]
    --> D[Webhook fires\nresync triggered]
    --> E[actualDelta computed\nhealthBefore vs healthAfter]
    --> F{Accuracy check}

    F -->|predicted ≈ actual| G[Accuracy rises\nTrust builds]
    F -->|large gap| H[Accuracy falls\nAdvisor needs tuning]

    G --> I[/agent-performance page\nAccuracy: 82%\nSuccess rate: 84%\nHours saved: 14h\nPortfolio score gained: +31/]
    H --> I
```

---

## Task Risk Tiers — Phase C Routing

```mermaid
flowchart TD
    Q[Task queued from advisor] --> T{Risk tier?}

    T -->|Tier 1 — Zero Risk| D1[Documentation fix\nREADME gaps, missing sections]
    T -->|Tier 2 — Low Risk| D2[Dependency update\nCI / test fix]
    T -->|Tier 3 — Medium Risk| D3[Security alert fix\nOnly after Tier 1-2 proven]

    D1 --> E1[Direct Claude prompt\nno gstack]
    D2 --> E2[gstack /ship skill]
    D3 --> E3[gstack /investigate skill]

    E1 --> OUT[.nexus/output.json\ncontract]
    E2 --> OUT
    E3 --> OUT

    OUT --> PR[PR created as draft]

    style D1 fill:#14532d,color:#bbf7d0
    style D2 fill:#1e3a5f,color:#bfdbfe
    style D3 fill:#7c2d12,color:#fed7aa
```

---

## Full Lifecycle (Phases A–D)

```mermaid
stateDiagram-v2
    [*] --> AdvisorGenerated : Daily sync completes

    AdvisorGenerated --> Queued : User clicks Queue button\n(predictedDelta stored)
    AdvisorGenerated --> [*] : User ignores action

    Queued --> Preparing : Human approves in Nexus
    Queued --> Cancelled : Human rejects

    Preparing --> Executing : Context prepared\nget_coding_brief read via MCP

    Executing --> ValidationPassed : Tests pass
    Executing --> ValidationFailed : Tests fail
    Executing --> Blocked : Agent cannot proceed

    ValidationFailed --> [*] : Execution abandoned
    Blocked --> [*] : Execution abandoned

    ValidationPassed --> PROpen : Human approves diff\nDraft PR created

    PROpen --> Merged : Human merges PR
    PROpen --> Closed : Human closes PR

    Merged --> AccuracyLogged : Webhook fires\nactualDelta computed
    Closed --> [*]

    AccuracyLogged --> PerformanceUpdated : portfolio_events written\nlog_session_complete called
    PerformanceUpdated --> [*]
```

---

## Multi-User Path (Future — Not Phase A-D)

```mermaid
timeline
    title Evolution: Personal → Shared → SaaS
    section Today (Phase A-D)
        Personal only : One Nexus instance
                      : One operator login
                      : Your repos only
                      : Service token in RepoHQ env
    section 3-6 months
        Trusted sharing : Nexus adds user signup
                        : Workspace RBAC
                        : Multiple operator accounts
                        : Per-user GitHub tokens
    section 6-12 months
        Hosted SaaS : Nexus hosted on Render
                    : RepoHQ users self-service connect
                    : Subscription / usage billing
                    : render.yaml already ready
```
