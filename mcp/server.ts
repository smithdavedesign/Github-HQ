/**
 * RepoHQ MCP Server
 *
 * Exposes your portfolio intelligence to Claude Code and MCP-compatible clients.
 * Run with: npx tsx mcp/server.ts
 *
 * Add to ~/.claude/claude.json:
 * {
 *   "mcpServers": {
 *     "repohq": {
 *       "command": "npx",
 *       "args": ["tsx", "/absolute/path/to/RepoHQ/mcp/server.ts"],
 *       "env": { "DATABASE_URL": "your-neon-url", "MCP_USER_ID": "your-user-id" }
 *     }
 *   }
 * }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from '../src/lib/db/schema.js'
import { eq, and, desc, inArray } from 'drizzle-orm'

const DATABASE_URL = process.env.DATABASE_URL
const USER_ID = process.env.MCP_USER_ID

if (!DATABASE_URL) {
  process.stderr.write('ERROR: DATABASE_URL environment variable is required\n')
  process.exit(1)
}
if (!USER_ID) {
  process.stderr.write('ERROR: MCP_USER_ID environment variable is required\n')
  process.exit(1)
}

const sql = neon(DATABASE_URL)
const db = drizzle(sql, { schema })

const server = new Server(
  { name: 'repohq', version: '1.0.0' },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'get_portfolio_summary',
      description: 'Get overall portfolio health: score, grade, top priorities from the advisor, and active goals. Call this when starting a new session to get context on your portfolio state.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'get_repo_context',
      description: 'Get full context for a specific repo: health score, lifecycle stage, focus status, tech debt level, estimated effort, recent advisor actions, and open security alerts. Call this when working in or discussing a specific repo.',
      inputSchema: {
        type: 'object',
        properties: {
          repo_name: { type: 'string', description: 'Repository name (e.g. "repohq" or "my-app")' },
        },
        required: ['repo_name'],
      },
    },
    {
      name: 'get_portfolio_warnings',
      description: 'Get active warnings: failing builds, security alerts, health drops, and concentration risks. Call this to understand what needs immediate attention.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'get_top_opportunities',
      description: 'Get the top repos by opportunity score with their potential score deltas. Use this to understand which repos have the highest upside.',
      inputSchema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'Number of repos to return (default 5)' },
        },
      },
    },
    {
      name: 'get_active_goals',
      description: 'Get current portfolio goals with progress and deadline status.',
      inputSchema: { type: 'object', properties: {} },
    },

    // ── Phase 45: Agentic coding tools ──────────────────────────────────
    {
      name: 'get_coding_brief',
      description: 'Get a full session-start context document for a specific repo — health, lifecycle, tech stack, advisor actions, tech debt, security alerts, active goals, and recent session history. Paste this at the start of any coding session so the agent has complete context without you re-explaining anything.',
      inputSchema: {
        type: 'object',
        properties: {
          repo_name: { type: 'string', description: 'Repository name (e.g. "repohq")' },
        },
        required: ['repo_name'],
      },
    },
    {
      name: 'get_next_action',
      description: 'Get the single highest-ROI action to take right now across your whole portfolio. Uses the advisor recommendations + opportunity scores + active goals to return one concrete, executable task. Call this when you want the agent to decide what to work on.',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'log_session_complete',
      description: 'Record what was accomplished in this coding session. Creates a portfolio_events entry so future sessions know what was done and whether advisor recommendations were followed. Call this at the end of a coding session.',
      inputSchema: {
        type: 'object',
        properties: {
          repo_name:  { type: 'string', description: 'Repository that was worked on' },
          summary:    { type: 'string', description: 'What was accomplished this session (1-3 sentences)' },
          agent_name: { type: 'string', description: 'AI agent that did the work (e.g. "Claude Code", "Cursor", "Copilot")' },
        },
        required: ['repo_name', 'summary'],
      },
    },

    // ── G7: Full lifecycle gstack skill integration ───────────────────
    {
      name: 'queue_gstack_skill',
      description: 'Trigger a gstack skill across the full repo lifecycle. Skills by phase — Understand: /investigate (debug+fix), /review (code review); Build Quality: /qa-only (report bugs), /qa (fix bugs); Ship: /ship (create PR), /document-release (update docs); Monitor: /health (code quality score), /canary (live app check); Reflect: /retro (weekly commit analysis). Returns a taskId to poll with get_active_work().',
      inputSchema: {
        type: 'object',
        properties: {
          repo_name: { type: 'string', description: 'Repository name (e.g. "repohq")' },
          skill:     { type: 'string', enum: ['investigate', 'review', 'qa-only', 'qa', 'ship', 'document-release', 'health', 'canary', 'retro'], description: 'gstack skill to run' },
          objective: { type: 'string', description: 'What the agent should do — defaults to a sensible objective if omitted' },
        },
        required: ['repo_name', 'skill'],
      },
    },
    {
      name: 'get_skill_history',
      description: 'Get recent gstack skill run history for a repo. Shows what skills ran, what findings they produced, and when. Useful before running a skill again — "what did the last health check find?"',
      inputSchema: {
        type: 'object',
        properties: {
          repo_name: { type: 'string', description: 'Repository name' },
          skill:     { type: 'string', description: 'Filter to a specific skill (e.g. "health") — omit for all skills' },
        },
        required: ['repo_name'],
      },
    },

    // ── Phase 52: Accuracy report ────────────────────────────────────────
    {
      name: 'get_accuracy_report',
      description: 'Get the advisor accuracy calibration table — how well each action type (security, health, opportunity, revenue) has predicted actual portfolio improvements. Use this before queuing actions to understand which types have a strong track record vs which need more caution.',
      inputSchema: { type: 'object', properties: {} },
    },

    // ── Phase 50: Active work signal ────────────────────────────────────
    {
      name: 'get_active_work',
      description: 'Check what agent work is currently in flight for a repo (or the whole portfolio). Returns open agent PRs, their stage, and whether it is safe to start a new session. Always call this before starting automated work on a repo to avoid collisions.',
      inputSchema: {
        type: 'object',
        properties: {
          repo_name: { type: 'string', description: 'Repo to check (omit for portfolio-wide view)' },
        },
      },
    },

    // ── Phase 51: Attempt log ────────────────────────────────────────────
    {
      name: 'log_attempt',
      description: 'Record that an agent tried an action on a repo and what happened. Call this whenever an automated attempt finishes — success, failure, or partial. This feeds back to the advisor so it stops recommending approaches that do not work.',
      inputSchema: {
        type: 'object',
        properties: {
          repo_name:  { type: 'string', description: 'Repository the attempt was made on' },
          action:     { type: 'string', description: 'What was attempted (e.g. "add unit tests", "fix CVE-2024-1234")' },
          outcome:    { type: 'string', enum: ['success', 'failed', 'partial'], description: 'Result of the attempt' },
          reason:     { type: 'string', description: 'Why it failed or what was partial (omit for success)' },
          agent_name: { type: 'string', description: 'Agent that made the attempt' },
        },
        required: ['repo_name', 'action', 'outcome'],
      },
    },
  ],
}))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    switch (name) {
      case 'get_portfolio_summary': {
        const [repos, latestDigest, latestScore] = await Promise.all([
          db.query.repositories.findMany({
            where: eq(schema.repositories.userId, USER_ID),
            with: { metrics: true },
            columns: { id: true, name: true, lifecycleStatus: true, isFocused: true, mrr: true, isArchived: true },
          }),
          db.query.digests.findFirst({
            where: eq(schema.digests.userId, USER_ID),
            orderBy: [desc(schema.digests.generatedAt)],
            columns: { advisorContent: true, generatedAt: true },
          }),
          db.query.portfolioScoreHistory.findFirst({
            where: eq(schema.portfolioScoreHistory.userId, USER_ID),
            orderBy: (h, { desc }) => [desc(h.recordedDate)],
          }),
        ])

        const active = repos.filter(r => !r.isArchived)
        const avgHealth = active.reduce((s, r) => s + (r.metrics?.healthScore ?? 0), 0) / (active.length || 1)
        const totalMrr = active.reduce((s, r) => s + parseFloat(String(r.mrr ?? '0')), 0)
        const focused = active.filter(r => r.isFocused).map(r => r.name)

        const advisor = latestDigest?.advisorContent as { headline?: string; actions?: Array<{ repoName: string; action: string; estimatedImpact: string }> } | null

        const lines = [
          `# RepoHQ Portfolio Summary`,
          ``,
          `**Portfolio Score:** ${latestScore?.score ?? 'No snapshot yet'} ${latestScore ? `(${gradeLabel(latestScore.score)})` : ''}`,
          `**Repos:** ${active.length} active · ${repos.filter(r => r.isArchived).length} archived`,
          `**Avg Health:** ${Math.round(avgHealth)}`,
          `**MRR:** $${totalMrr.toFixed(0)}/mo`,
          `**Focused repos:** ${focused.length ? focused.join(', ') : 'none set'}`,
          ``,
        ]

        if (advisor?.headline) {
          lines.push(`## Advisor Headline`, advisor.headline, ``)
          if (advisor.actions?.length) {
            lines.push(`## Top Actions`)
            for (const a of advisor.actions.slice(0, 3)) {
              lines.push(`- **${a.repoName}**: ${a.action} (${a.estimatedImpact})`)
            }
          }
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] }
      }

      case 'get_repo_context': {
        const repoName = (args as { repo_name: string }).repo_name
        const repo = await db.query.repositories.findFirst({
          where: and(
            eq(schema.repositories.userId, USER_ID),
            eq(schema.repositories.name, repoName),
          ),
          with: {
            metrics: true,
            techStack: true,
            securityFindings: { where: eq(schema.securityFindings.state, 'open') },
            deployments: { columns: { url: true, status: true, provider: true } },
          },
        })

        if (!repo) {
          return { content: [{ type: 'text', text: `Repo "${repoName}" not found in RepoHQ. Make sure it's synced.` }] }
        }

        const m = repo.metrics
        const criticalAlerts = repo.securityFindings.filter(f => f.severity === 'critical' || f.severity === 'high')
        const analysis = repo.claudeAnalysis as { techDebt?: { level?: string }; overallScore?: number } | null

        const lines = [
          `# ${repo.name}`,
          ``,
          `**Lifecycle:** ${repo.lifecycleStatus ?? 'unknown'}`,
          `**Focus:** ${repo.isFocused ? '⭐ Focused' : 'Not focused'}`,
          `**Purpose:** ${repo.purpose ?? 'not set'}`,
          `**Effort level:** ${repo.estimatedEffort ?? 'not set'}`,
          `**MRR:** $${parseFloat(String(repo.mrr ?? '0')).toFixed(0)}/mo`,
          ``,
          `## Health`,
          `- Health score: ${m?.healthScore != null ? Math.round(m.healthScore) : 'unknown'}`,
          `- Activity score: ${m?.activityScore != null ? Math.round(m.activityScore) : 'unknown'}`,
          `- Security score: ${m?.securityScore != null ? Math.round(m.securityScore) : 'unknown'}`,
          `- Activity status: ${m?.activityStatus ?? 'unknown'}`,
          `- Build status: ${m?.buildStatus ?? 'unknown'}`,
          `- Opportunity score: ${m?.opportunityScore != null ? Math.round(m.opportunityScore) : 'unknown'}`,
          `- Archive score: ${m?.archiveScore != null ? Math.round(m.archiveScore) : 'unknown'} (higher = stronger archive candidate)`,
          ``,
          `## Tech Stack`,
          `- Frontend: ${repo.techStack?.frontend ?? 'unknown'}`,
          `- Backend: ${repo.techStack?.backend ?? 'unknown'}`,
          `- Database: ${repo.techStack?.database ?? 'unknown'}`,
          `- Hosting: ${repo.techStack?.hosting ?? 'unknown'}`,
          `- Testing: ${repo.techStack?.testing ?? 'unknown'}`,
          ``,
        ]

        if (analysis) {
          lines.push(
            `## Claude Analysis`,
            `- Tech debt: ${analysis.techDebt?.level ?? 'unknown'}`,
            `- Overall score: ${analysis.overallScore ?? 'unknown'}`,
            ``,
          )
        }

        if (criticalAlerts.length > 0) {
          lines.push(`## ⚠ Security Alerts (${criticalAlerts.length} open)`)
          for (const f of criticalAlerts.slice(0, 3)) {
            lines.push(`- [${f.severity.toUpperCase()}] ${f.title}`)
          }
          lines.push(``)
        }

        if (repo.deployments.length > 0) {
          lines.push(`## Deployments`)
          for (const d of repo.deployments) {
            lines.push(`- ${d.url} (${d.provider ?? 'unknown'}) — ${d.status}`)
          }
          lines.push(``)
        }

        if (repo.lifecycleStatus === 'sunsetting' || repo.lifecycleStatus === 'archived') {
          lines.push(`> ⚠ This repo is marked as **${repo.lifecycleStatus}**. Avoid investing significant effort here.`)
          if (repo.abandonmentReason) lines.push(`> Abandonment reason: ${repo.abandonmentReason}`)
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] }
      }

      case 'get_portfolio_warnings': {
        const repos = await db.query.repositories.findMany({
          where: eq(schema.repositories.userId, USER_ID),
          with: {
            metrics: true,
            securityFindings: { where: eq(schema.securityFindings.state, 'open') },
          },
          columns: { id: true, name: true, lifecycleStatus: true },
        })

        const warnings: string[] = []

        for (const r of repos) {
          if (r.metrics?.buildStatus === 'failure') {
            warnings.push(`❌ **${r.name}**: Build failing`)
          }
          const critical = r.securityFindings.filter(f => f.severity === 'critical')
          if (critical.length > 0) {
            warnings.push(`🔴 **${r.name}**: ${critical.length} critical security alert${critical.length > 1 ? 's' : ''}`)
          }
          if ((r.metrics?.healthScore ?? 100) < 50) {
            warnings.push(`🟡 **${r.name}**: Low health score (${Math.round(r.metrics?.healthScore ?? 0)})`)
          }
        }

        const text = warnings.length > 0
          ? `# Portfolio Warnings\n\n${warnings.join('\n')}`
          : `# Portfolio Warnings\n\nNo critical warnings — portfolio looks healthy.`

        return { content: [{ type: 'text', text }] }
      }

      case 'get_top_opportunities': {
        const limit = (args as { limit?: number }).limit ?? 5

        const repos = await db.query.repositories.findMany({
          where: eq(schema.repositories.userId, USER_ID),
          with: { metrics: true },
          columns: { id: true, name: true, lifecycleStatus: true, isFocused: true, isArchived: true },
        })

        const sorted = repos
          .filter(r => r.metrics?.opportunityScore != null && !r.isArchived && r.lifecycleStatus !== 'archived')
          .sort((a, b) => (b.metrics!.opportunityScore! - a.metrics!.opportunityScore!))
          .slice(0, limit)

        const lines = [`# Top Opportunities`, ``]
        for (const r of sorted) {
          const m = r.metrics!
          lines.push(
            `**${r.name}** ${r.isFocused ? '⭐' : ''}`,
            `- Opportunity: ${Math.round(m.opportunityScore!)} · Health: ${Math.round(m.healthScore ?? 0)} · Activity: ${Math.round(m.activityScore ?? 0)}`,
            `- Lifecycle: ${r.lifecycleStatus ?? 'unknown'}`,
            ``,
          )
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] }
      }

      case 'get_active_goals': {
        const goals = await db.query.goals.findMany({
          where: and(eq(schema.goals.userId, USER_ID), eq(schema.goals.isActive, true)),
        })

        if (goals.length === 0) {
          return { content: [{ type: 'text', text: 'No active goals set. Add goals in RepoHQ Settings.' }] }
        }

        const lines = [`# Active Goals`, ``]
        for (const g of goals) {
          const pct = Math.round(((g.currentValue ?? 0) / g.targetValue) * 100)
          const status = pct >= 100 ? '✅' : pct >= 70 ? '🟡' : '🔴'
          lines.push(`${status} **${g.name}**: ${g.currentValue ?? 0} / ${g.targetValue} ${g.unit ?? ''} (${pct}%)`)
          if (g.deadline) lines.push(`   Deadline: ${g.deadline}`)
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] }
      }

      // ── Phase 45: Agentic coding tools ──────────────────────────────────

      case 'get_coding_brief': {
        const repoName = (args as { repo_name: string }).repo_name

        // Phase 54-T1: Serve from cache if fresh (populated by sync, cleared on next sync)
        const cachedRepo = await db.query.repositories.findFirst({
          where: and(eq(schema.repositories.userId, USER_ID!), eq(schema.repositories.name, repoName)),
          columns: { id: true, cachedBrief: true },
        })
        if (cachedRepo?.cachedBrief) {
          const cached = cachedRepo.cachedBrief as { raw: string; generatedAt: string }
          const ageMs = Date.now() - new Date(cached.generatedAt).getTime()
          const SIX_HOURS = 6 * 60 * 60 * 1000
          if (ageMs < SIX_HOURS && cached.raw) {
            return { content: [{ type: 'text', text: cached.raw + '\n\n_[served from cache — regenerates on next sync]_' }] }
          }
        }

        const repo = await db.query.repositories.findFirst({
          where: and(eq(schema.repositories.userId, USER_ID), eq(schema.repositories.name, repoName)),
          with: {
            metrics: true,
            techStack: true,
            securityFindings: { where: eq(schema.securityFindings.state, 'open') },
            deployments: { columns: { url: true, status: true, provider: true } },
          },
        })

        if (!repo) {
          return { content: [{ type: 'text', text: `Repo "${repoName}" not found. Make sure it's synced.` }] }
        }

        // Fetch sessions, attempts, and open PRs in parallel
        const [recentSessions, recentAttempts, openPRMap] = await Promise.all([
          db.query.portfolioEvents.findMany({
            where: and(
              eq(schema.portfolioEvents.userId, USER_ID),
              eq(schema.portfolioEvents.repoId, repo.id),
              eq(schema.portfolioEvents.eventType, 'session_complete'),
            ),
            orderBy: [desc(schema.portfolioEvents.occurredAt)],
            limit: 3,
          }),
          db.query.portfolioEvents.findMany({
            where: and(
              eq(schema.portfolioEvents.userId, USER_ID),
              eq(schema.portfolioEvents.repoId, repo.id),
              eq(schema.portfolioEvents.eventType, 'agent_attempt'),
            ),
            orderBy: [desc(schema.portfolioEvents.occurredAt)],
            limit: 5,
          }),
          getOpenAgentPRMap(),
        ])

        const m = repo.metrics
        const criticalAlerts = repo.securityFindings.filter(f => f.severity === 'critical' || f.severity === 'high')
        const analysis = repo.claudeAnalysis as { techDebt?: { level?: string }; overallScore?: number; recommendations?: Array<{ priority: string; action: string }> } | null

        const lines = [
          `# ${repo.name} — Coding Brief`,
          `_Generated by RepoHQ · ${new Date().toISOString().split('T')[0]}_`,
          ``,
          `## Status`,
          `- **Lifecycle:** ${repo.lifecycleStatus ?? 'not set'}`,
          `- **Focus:** ${repo.isFocused ? '⭐ Focused' : 'Not focused'}`,
          `- **Purpose:** ${repo.purpose ?? 'not set'}`,
          `- **Effort:** ${repo.estimatedEffort ?? 'not set'}`,
          `- **MRR:** $${parseFloat(String(repo.mrr ?? '0')).toFixed(0)}/mo`,
          ``,
          `## Health`,
          `- Health: ${m?.healthScore != null ? Math.round(m.healthScore) : '?'}/100`,
          `- Activity: ${m?.activityScore != null ? Math.round(m.activityScore) : '?'}/100`,
          `- Security: ${m?.securityScore != null ? Math.round(m.securityScore) : '?'}/100`,
          `- Build: ${m?.buildStatus ?? 'unknown'}`,
          `- Activity status: ${m?.activityStatus ?? 'unknown'}`,
          `- Last push: ${m?.lastPush ? new Date(m.lastPush).toLocaleDateString() : 'unknown'}`,
          ``,
        ]

        // Tech stack
        if (repo.techStack) {
          const ts = repo.techStack
          const stack = [ts.frontend, ts.backend, ts.database, ts.hosting, ts.testing, ts.language]
            .filter(Boolean).join(' · ')
          lines.push(`## Tech Stack`, stack || 'Not detected', ``)
        }

        // Deployments
        if (repo.deployments.length > 0) {
          lines.push(`## Deployments`)
          for (const d of repo.deployments) {
            lines.push(`- ${d.url} (${d.provider ?? 'unknown'}) — **${d.status}**`)
          }
          lines.push(``)
        }

        // Security alerts
        if (criticalAlerts.length > 0) {
          lines.push(`## ⚠ Security Alerts (${criticalAlerts.length} open)`)
          for (const f of criticalAlerts.slice(0, 5)) {
            lines.push(`- [${f.severity.toUpperCase()}] ${f.title}`)
          }
          lines.push(``)
        }

        // Claude analysis / tech debt
        if (analysis) {
          lines.push(`## Code Analysis (Claude)`)
          lines.push(`- Overall score: ${analysis.overallScore ?? '?'}/100`)
          lines.push(`- Tech debt: **${analysis.techDebt?.level ?? 'unknown'}**`)
          if (analysis.recommendations && analysis.recommendations.length > 0) {
            lines.push(`- Top actions:`)
            for (const r of analysis.recommendations.slice(0, 3)) {
              lines.push(`  - [${r.priority}] ${r.action}`)
            }
          }
          lines.push(``)
        }

        // Lifecycle warning
        if (repo.lifecycleStatus === 'sunsetting' || repo.lifecycleStatus === 'archived') {
          lines.push(`> ⚠ **${repo.lifecycleStatus.toUpperCase()}** — This repo is winding down. Avoid significant new investment.`)
          if (repo.abandonmentReason) lines.push(`> Reason: ${repo.abandonmentReason}`)
          lines.push(``)
        }

        // In Flight — open agent PRs (Phase 50)
        const openPR = openPRMap.get(repo.id)
        if (openPR) {
          lines.push(
            `## ⚠ Agent PR In Flight`,
            `An agent PR is currently open for this repo. Review it before starting new work.`,
            `- PR: ${openPR.prUrl || 'URL pending'}`,
            `- Task ID: \`${openPR.taskId}\``,
            `- Queued: ${openPR.queuedAt.toLocaleDateString()}`,
            ``,
          )
        }

        // Attempt history (Phase 51)
        if (recentAttempts.length > 0) {
          lines.push(`## Recent Attempts`)
          for (const a of recentAttempts) {
            const meta = a.metadata as { action?: string; outcome?: string; reason?: string; agent?: string } | null
            const emoji = meta?.outcome === 'success' ? '✅' : meta?.outcome === 'partial' ? '⚠️' : '❌'
            const date = new Date(a.occurredAt).toLocaleDateString()
            lines.push(`- ${emoji} **${date}**: ${meta?.action ?? a.title}${meta?.reason ? ` — ${meta.reason}` : ''}`)
          }
          const failCount = recentAttempts.filter(a => {
            const m = a.metadata as { outcome?: string } | null
            return m?.outcome === 'failed'
          }).length
          if (failCount >= 2) {
            lines.push(`> ⚠ ${failCount} recent failures — approach with fresh context or escalate to human review.`)
          }
          lines.push(``)
        }

        // Recent session history (agent meta-awareness)
        if (recentSessions.length > 0) {
          lines.push(`## Recent Sessions`)
          for (const s of recentSessions) {
            const meta = s.metadata as { agent?: string; summary?: string } | null
            const agent = meta?.agent ?? 'unknown agent'
            const date = new Date(s.occurredAt).toLocaleDateString()
            lines.push(`- **${date}** (${agent}): ${s.title}`)
          }
          lines.push(``)
        }

        lines.push(`_Use \`log_attempt\` after each automated action and \`log_session_complete\` when done._`)

        const briefText = lines.join('\n')

        // Write to cache (TTL enforced on read; sync invalidates by setting null)
        if (repo.id) {
          db.update(schema.repositories)
            .set({ cachedBrief: { raw: briefText, generatedAt: new Date().toISOString() } })
            .where(eq(schema.repositories.id, repo.id))
            .catch(() => {}) // fire-and-forget, never fail the brief
        }

        return { content: [{ type: 'text', text: briefText }] }
      }

      case 'get_next_action': {
        const [repos, latestDigest, openPRMap, deadEnds, accuracyStats] = await Promise.all([
          db.query.repositories.findMany({
            where: eq(schema.repositories.userId, USER_ID),
            with: { metrics: true },
            columns: {
              id: true, name: true, lifecycleStatus: true, isFocused: true,
              isArchived: true, purpose: true, mrr: true,
            },
          }),
          db.query.digests.findFirst({
            where: eq(schema.digests.userId, USER_ID),
            orderBy: [desc(schema.digests.generatedAt)],
            columns: { advisorContent: true, generatedAt: true },
          }),
          getOpenAgentPRMap(),
          getDeadEndActions(),
          getAccuracyStatsMCP(),
        ])

        const advisor = latestDigest?.advisorContent as {
          headline?: string
          actions?: Array<{ repoId: number; repoName: string; action: string; impactType: string; estimatedImpact: string; effort: string; reasoning: string }>
        } | null

        // Pick the top advisor action: active, non-Reference, no open PR, not a dead end
        const SKIP_PURPOSES = new Set(['Reference', 'Infrastructure'])
        const topAction = advisor?.actions?.find(a => {
          const repo = repos.find(r => r.id === a.repoId)
          if (!repo) return false
          if (repo.isArchived || ['archived', 'sunsetting'].includes(repo.lifecycleStatus ?? '')) return false
          if (SKIP_PURPOSES.has(repo.purpose ?? '')) return false
          if (openPRMap.has(repo.id)) return false  // Phase 50: skip repos with open PRs
          const deadEndKey = `${repo.id}::${a.action.toLowerCase().slice(0, 60)}`
          if (deadEnds.has(deadEndKey)) return false  // Phase 51: skip known dead ends
          return true
        })

        if (!topAction) {
          // Fallback: highest opportunity active repo
          const best = repos
            .filter(r => !r.isArchived && !['archived', 'sunsetting'].includes(r.lifecycleStatus ?? ''))
            .sort((a, b) => (b.metrics?.opportunityScore ?? 0) - (a.metrics?.opportunityScore ?? 0))[0]

          const text = best
            ? `No advisor data yet. Highest opportunity repo: **${best.name}** (opp score: ${Math.round(best.metrics?.opportunityScore ?? 0)}). Run the Advisor in RepoHQ to get quantified actions.`
            : 'No active repos found. Run a sync first.'
          return { content: [{ type: 'text', text: text }] }
        }

        const repo = repos.find(r => r.id === topAction.repoId)

        // Include accuracy context for this impactType
        const accuracyStat = accuracyStats.find(s => s.impactType === topAction.impactType)
        let confidenceLine = ''
        if (accuracyStat?.hasSignal) {
          const rate = accuracyStat.successRate
          const label = rate >= 75 ? '🟢 High confidence' : rate >= 50 ? '🟡 Mixed results' : '🔴 Low confidence'
          confidenceLine = `**Confidence:** ${label} (${topAction.impactType} actions: ${rate}% success rate across ${accuracyStat.dataPoints} runs, avg +${accuracyStat.avgActualDelta} pts)`
        } else if (accuracyStat && accuracyStat.dataPoints > 0) {
          confidenceLine = `**Confidence:** ⚪ Building signal (${accuracyStat.dataPoints} run${accuracyStat.dataPoints !== 1 ? 's' : ''} — need ${MIN_DATA_POINTS_MAP[topAction.impactType] ?? 3}+ for reliable signal)`
        } else {
          confidenceLine = `**Confidence:** ⚪ No data yet for ${topAction.impactType} actions`
        }

        const lines = [
          `# Next Action`,
          ``,
          `**Repo:** ${topAction.repoName}${repo?.isFocused ? ' ⭐' : ''}`,
          `**Action:** ${topAction.action}`,
          `**Impact:** ${topAction.estimatedImpact}`,
          `**Effort:** ${topAction.effort}`,
          confidenceLine,
          `**Why:** ${topAction.reasoning}`,
          ``,
          advisor?.headline ? `_Portfolio context: ${advisor.headline}_` : '',
        ].filter(Boolean)

        return { content: [{ type: 'text', text: lines.join('\n') }] }
      }

      case 'log_session_complete': {
        const { repo_name, summary, agent_name } = args as {
          repo_name: string
          summary: string
          agent_name?: string
        }

        const repo = await db.query.repositories.findFirst({
          where: and(eq(schema.repositories.userId, USER_ID), eq(schema.repositories.name, repo_name)),
          columns: { id: true, name: true },
        })

        if (!repo) {
          return { content: [{ type: 'text', text: `Repo "${repo_name}" not found — session not logged.` }] }
        }

        const agent = agent_name ?? 'Unknown agent'
        const title = `Session: ${summary.slice(0, 80)}${summary.length > 80 ? '…' : ''}`

        await db.insert(schema.portfolioEvents).values({
          userId: USER_ID,
          repoId: repo.id,
          eventType: 'session_complete',
          title,
          description: summary,
          metadata: { agent, loggedAt: new Date().toISOString() },
        })

        return {
          content: [{
            type: 'text',
            text: `✓ Session logged for **${repo.name}**\nAgent: ${agent}\nSummary: ${summary}`,
          }],
        }
      }

      case 'get_skill_history': {
        const { repo_name, skill: filterSkill } = args as { repo_name: string; skill?: string }

        const repo = await db.query.repositories.findFirst({
          where: and(eq(schema.repositories.userId, USER_ID!), eq(schema.repositories.name, repo_name)),
          columns: { id: true, name: true },
        })
        if (!repo) return { content: [{ type: 'text', text: `Repo "${repo_name}" not found.` }] }

        const events = await db.query.portfolioEvents.findMany({
          where: and(
            eq(schema.portfolioEvents.userId, USER_ID!),
            eq(schema.portfolioEvents.repoId, repo.id),
            inArray(schema.portfolioEvents.eventType, ['agent_skill_report', 'agent_execution_failed']),
          ),
          columns: { eventType: true, metadata: true, occurredAt: true, title: true },
          orderBy: [desc(schema.portfolioEvents.occurredAt)],
          limit: 20,
        })

        const filtered = filterSkill
          ? events.filter(e => (e.metadata as { skillName?: string } | null)?.skillName === filterSkill)
          : events

        if (filtered.length === 0) {
          return { content: [{ type: 'text', text: `No skill history found for **${repo_name}**${filterSkill ? ` (/${filterSkill})` : ''}.` }] }
        }

        const lines = [`# Skill History — ${repo_name}`, '']
        for (const e of filtered.slice(0, 5)) {
          const meta = e.metadata as { skillName?: string; findings?: string[]; summary?: string } | null
          const date = new Date(e.occurredAt).toLocaleDateString()
          const skill = meta?.skillName ?? 'unknown'
          const isFailed = e.eventType === 'agent_execution_failed'
          lines.push(`## /${skill} — ${date}${isFailed ? ' ❌ Failed' : ''}`)
          if (meta?.summary) lines.push(meta.summary)
          if (meta?.findings?.length) {
            for (const f of meta.findings.slice(0, 5)) lines.push(`- ${f}`)
            if ((meta.findings.length ?? 0) > 5) lines.push(`- …${meta.findings.length - 5} more findings`)
          }
          lines.push('')
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] }
      }

      case 'queue_gstack_skill': {
        const { repo_name, skill, objective: rawObjective } = args as {
          repo_name: string
          skill: 'investigate' | 'review' | 'qa-only' | 'qa' | 'ship' | 'document-release' | 'health' | 'canary' | 'retro'
          objective?: string
        }

        const repo = await db.query.repositories.findFirst({
          where: and(eq(schema.repositories.userId, USER_ID), eq(schema.repositories.name, repo_name)),
          with: { metrics: { columns: { buildStatus: true, healthScore: true } }, securityFindings: { where: eq(schema.securityFindings.state, 'open') } },
          columns: { id: true, name: true, fullName: true },
        })
        if (!repo) {
          return { content: [{ type: 'text', text: `Repo "${repo_name}" not found. Make sure it's synced.` }] }
        }

        // Smart default objectives based on skill + repo state
        const openAlerts = repo.securityFindings?.filter(f => ['critical', 'high'].includes((f as { severity?: string }).severity ?? '')) ?? []
        const failingBuild = repo.metrics?.buildStatus === 'failure'
        const SKILL_DEFAULTS_MCP: Record<string, string> = {
          investigate: failingBuild
            ? `Investigate why the build is failing in ${repo.name} and fix the root cause`
            : openAlerts.length > 0
              ? `Investigate ${openAlerts.length} critical/high security alert${openAlerts.length > 1 ? 's' : ''} in ${repo.name}`
              : `Investigate code quality issues in ${repo.name}`,
          review:             `Review the latest changes before merging in ${repo.name}`,
          'qa-only':          `Find bugs in ${repo.name} and document them with repro steps`,
          qa:                 `Find and fix bugs in ${repo.name}`,
          ship:               `Ship latest changes in ${repo.name}`,
          'document-release': `Update README and docs to match what was shipped in ${repo.name}`,
          health:             `Run code health check on ${repo.name} — TypeScript errors, tests, dead code, lint`,
          canary:             `Monitor ${repo.name} live app for console errors and performance issues`,
          retro:              `Summarise this week's commits and engineering patterns in ${repo.name}`,
        }
        const defaultObjective = SKILL_DEFAULTS_MCP[skill] ?? `Run /${skill} on ${repo.name}`

        const objective = rawObjective?.trim() || defaultObjective

        // Lifecycle guard
        const lifecycle = await getOpenAgentPRMap()
        if (lifecycle.has(repo.id)) {
          const existing = lifecycle.get(repo.id)!
          return { content: [{ type: 'text', text: `⚠️ ${repo.name} already has an agent PR in flight (task ${existing.taskId}). Review or merge it first before launching another skill.` }] }
        }

        // Queue via Nexus
        const nexusUrl = process.env.NEXUS_API_URL?.replace(/\/$/, '')
        const nexusToken = process.env.NEXUS_API_TOKEN
        if (!nexusUrl || !nexusToken) {
          return { content: [{ type: 'text', text: `Nexus not configured (NEXUS_API_URL / NEXUS_API_TOKEN missing). Cannot queue skill.` }] }
        }

        const executionMode = skill === 'ship' ? 'fix' : 'investigate'
        const riskTier = skill === 'ship' ? 'tier2' : 'tier3'

        const res = await fetch(`${nexusUrl}/internal/agent-tasks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${nexusToken}` },
          body: JSON.stringify({
            objective,
            targetRepository: repo.fullName,
            executionMode,
            acceptanceCriteria: skill === 'investigate'
              ? ['Root cause identified and documented', 'Findings listed with file paths', 'No new issues introduced']
              : skill === 'health'
                ? ['Code quality report produced', 'Critical issues listed', 'Health score computed']
                : ['Changes implement the objective', 'Tests pass', 'PR created'],
            contextNotes: JSON.stringify({
              repoHQRepoId:   repo.id,
              repoHQRepoName: repo.name,
              skillName:      skill,
              riskTier,
              source:         'repohq-mcp-agent',
              autoExecute:    true,
            }),
          }),
        })

        if (!res.ok) {
          const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
          return { content: [{ type: 'text', text: `Nexus error: ${err.error?.message ?? res.statusText}` }], isError: true }
        }

        const data = await res.json() as { agentTaskId: string; status: string }

        // Record in portfolio_events
        await db.insert(schema.portfolioEvents).values({
          userId:    USER_ID!,
          repoId:    repo.id,
          eventType: 'agent_task_queued',
          title:     `gstack /${skill}: ${objective.slice(0, 80)}`,
          description: objective,
          metadata: {
            taskId:    data.agentTaskId,
            skillName: skill,
            source:    'repohq-mcp-agent',
            riskTier,
            nexusUrl,
          },
        })

        return {
          content: [{
            type: 'text',
            text: [
              `✓ gstack /${skill} queued for **${repo.name}**`,
              `Task ID: \`${data.agentTaskId}\``,
              `Objective: ${objective}`,
              ``,
              `Track progress with: \`get_active_work("${repo.name}")\``,
            ].join('\n'),
          }],
        }
      }

      case 'get_accuracy_report': {
        const [accuracyStats, allEvents] = await Promise.all([
          getAccuracyStatsMCP(),
          db.query.portfolioEvents.findMany({
            where: and(
              eq(schema.portfolioEvents.userId, USER_ID),
              inArray(schema.portfolioEvents.eventType, ['agent_pr_merged', 'agent_execution_failed']),
            ),
            columns: { repoId: true, eventType: true, metadata: true },
            with: { repository: { columns: { name: true } } },
          }),
        ])

        const lines = ['# Advisor Accuracy Report', '']

        const withData = accuracyStats.filter(s => s.dataPoints > 0)
        if (withData.length === 0) {
          lines.push('No completed agent runs yet. Queue advisor actions to start building accuracy data.')
          return { content: [{ type: 'text', text: lines.join('\n') }] }
        }

        lines.push('## Accuracy by Action Type', '')
        lines.push('| Type | Success Rate | Runs | Avg Δ | Signal |')
        lines.push('|------|-------------|------|-------|--------|')
        for (const s of accuracyStats) {
          const emoji = !s.dataPoints ? '⚪' : s.hasSignal && s.successRate >= 75 ? '🟢' : s.hasSignal && s.successRate >= 50 ? '🟡' : s.hasSignal ? '🔴' : '⚪'
          const rate = s.dataPoints > 0 ? `${s.successRate}%` : '—'
          const avg = s.avgActualDelta !== 0 ? `${s.avgActualDelta > 0 ? '+' : ''}${s.avgActualDelta} pts` : '—'
          const signal = !s.dataPoints ? 'No data' : s.hasSignal ? 'Strong' : `Building (${s.dataPoints}/${MIN_DATA_POINTS_MAP[s.impactType] ?? 3})`
          lines.push(`| ${emoji} ${s.impactType.padEnd(10)} | ${rate.padEnd(11)} | ${String(s.dataPoints || '—').padEnd(4)} | ${avg.padEnd(5)} | ${signal} |`)
        }

        // Find downgraded repos
        type RepoKey = `${number}::${string}`
        const repoCounters = new Map<RepoKey, { total: number; failures: number; name: string }>()
        for (const e of allEvents) {
          if (!e.repoId) continue
          const m = e.metadata as { impactType?: string } | null
          if (!m?.impactType) continue
          const key = `${e.repoId}::${m.impactType}` as RepoKey
          if (!repoCounters.has(key)) repoCounters.set(key, { total: 0, failures: 0, name: e.repository?.name ?? '?' })
          const c = repoCounters.get(key)!
          c.total++
          if (e.eventType === 'agent_execution_failed') c.failures++
        }
        const downgraded = Array.from(repoCounters.entries())
          .filter(([key, c]) => {
            const impactType = key.split('::')[1]
            const t = { security: 0.70, revenue: 0.65, health: 0.60, opportunity: 0.60 }[impactType] ?? 0.60
            return c.total >= 3 && (c.failures / c.total) >= t
          })

        if (downgraded.length > 0) {
          lines.push('', '## Downgraded Repos (repeated failures)')
          for (const [key, c] of downgraded) {
            const [, impactType] = key.split('::')
            lines.push(`- **${c.name}** (${impactType}): ${c.failures}/${c.total} failures — advisor will caveat`)
          }
        }

        lines.push('', `_Accuracy = directional (did health score improve?). Time-decayed: last 30d weighted 2×._`)
        return { content: [{ type: 'text', text: lines.join('\n') }] }
      }

      case 'get_active_work': {
        const repoName = (args as { repo_name?: string }).repo_name

        // Get all repos for context
        const allRepos = await db.query.repositories.findMany({
          where: eq(schema.repositories.userId, USER_ID),
          columns: { id: true, name: true },
        })
        const repoById = new Map(allRepos.map(r => [r.id, r.name]))

        const openPRMap = await getOpenAgentPRMap()

        // Filter to specific repo if requested
        let relevantEntries: Array<{ repoId: number; repoName: string; prUrl: string; taskId: string; queuedAt: Date }>
        if (repoName) {
          const repo = allRepos.find(r => r.name === repoName)
          relevantEntries = repo && openPRMap.has(repo.id)
            ? [{ repoId: repo.id, repoName: repo.name, ...openPRMap.get(repo.id)! }]
            : []
        } else {
          relevantEntries = Array.from(openPRMap.entries()).map(([repoId, data]) => ({
            repoId, repoName: repoById.get(repoId) ?? `repo-${repoId}`, ...data,
          }))
        }

        if (relevantEntries.length === 0) {
          const scope = repoName ? `**${repoName}**` : 'your portfolio'
          return { content: [{ type: 'text', text: `✅ No active agent work in ${scope}. Safe to start a new session.` }] }
        }

        const lines = [`# Active Agent Work`, ``]
        for (const e of relevantEntries) {
          const age = Math.round((Date.now() - e.queuedAt.getTime()) / 3600_000)
          lines.push(
            `**${e.repoName}** — PR open (${age}h ago)`,
            `- PR: ${e.prUrl || 'URL pending'}`,
            `- Task ID: \`${e.taskId}\``,
            `- ⚠ Do not start a new agent session on this repo until the PR is reviewed.`,
            ``,
          )
        }

        return { content: [{ type: 'text', text: lines.join('\n') }] }
      }

      case 'log_attempt': {
        const { repo_name, action, outcome, reason, agent_name } = args as {
          repo_name: string; action: string; outcome: 'success' | 'failed' | 'partial'; reason?: string; agent_name?: string
        }

        const repo = await db.query.repositories.findFirst({
          where: and(eq(schema.repositories.userId, USER_ID), eq(schema.repositories.name, repo_name)),
          columns: { id: true, name: true },
        })

        if (!repo) {
          return { content: [{ type: 'text', text: `Repo "${repo_name}" not found — attempt not logged.` }] }
        }

        const outcomeEmoji = outcome === 'success' ? '✅' : outcome === 'partial' ? '⚠️' : '❌'
        const title = `${outcomeEmoji} Attempt: ${action.slice(0, 80)}${action.length > 80 ? '…' : ''}`

        await db.insert(schema.portfolioEvents).values({
          userId: USER_ID,
          repoId: repo.id,
          eventType: 'agent_attempt',
          title,
          description: reason ?? null,
          metadata: {
            action,
            outcome,
            reason: reason ?? null,
            agent: agent_name ?? 'Unknown agent',
            loggedAt: new Date().toISOString(),
          },
        })

        const feedbackMsg = outcome === 'failed'
          ? ` Logged as a dead end — the advisor will de-prioritise this action type for ${repo.name} after 2 failures.`
          : ''

        return {
          content: [{
            type: 'text',
            text: `${outcomeEmoji} Attempt logged for **${repo.name}**\nAction: ${action}\nOutcome: ${outcome}${reason ? `\nReason: ${reason}` : ''}${feedbackMsg}`,
          }],
        }
      }

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true }
  }
})

const MIN_DATA_POINTS_MAP: Record<string, number> = {
  security: 5, health: 3, opportunity: 3, revenue: 8,
}

interface MCPAccuracyStat {
  impactType: string
  successRate: number
  dataPoints: number
  avgActualDelta: number
  hasSignal: boolean
  timeDecayedRate: number
}

/** Compute accuracy stats directly from portfolio_events (no server action import needed) */
async function getAccuracyStatsMCP(): Promise<MCPAccuracyStat[]> {
  const events = await db.query.portfolioEvents.findMany({
    where: and(
      eq(schema.portfolioEvents.userId, USER_ID!),
      inArray(schema.portfolioEvents.eventType, ['agent_pr_merged', 'agent_execution_failed']),
    ),
    columns: { eventType: true, metadata: true, occurredAt: true },
  })

  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000)
  const impactTypes = ['opportunity', 'revenue', 'security', 'health']
  return impactTypes.map(impactType => {
    const relevant = events.filter(e => (e.metadata as { impactType?: string } | null)?.impactType === impactType)
    const merges = relevant.filter(e => e.eventType === 'agent_pr_merged')
    const failures = relevant.filter(e => e.eventType === 'agent_execution_failed')
    const highConf = merges.filter(e => {
      const m = e.metadata as { deltaConfidence?: string; actualDelta?: number; actualDeltaPending?: boolean } | null
      return m?.deltaConfidence !== 'low' && !m?.actualDeltaPending && m?.actualDelta != null
    })
    const dataPoints = highConf.length + failures.length
    const successes = highConf.filter(e => ((e.metadata as { actualDelta?: number } | null)?.actualDelta ?? 0) > 0)
    const successRate = dataPoints > 0 ? Math.round((successes.length / dataPoints) * 100) : 0
    const avgActualDelta = highConf.length > 0
      ? Math.round(highConf.reduce((s, e) => s + ((e.metadata as { actualDelta?: number } | null)?.actualDelta ?? 0), 0) / highConf.length)
      : 0
    const recentSuccesses = successes.filter(e => e.occurredAt >= thirtyDaysAgo).length
    const recentTotal = relevant.filter(e => e.occurredAt >= thirtyDaysAgo).length
    const weightedSuccesses = recentSuccesses * 2 + (successes.length - recentSuccesses)
    const weightedTotal = recentTotal * 2 + (dataPoints - recentTotal)
    const timeDecayedRate = weightedTotal > 0 ? Math.round((weightedSuccesses / weightedTotal) * 100) : 0
    return { impactType, successRate, dataPoints, avgActualDelta, hasSignal: dataPoints >= (MIN_DATA_POINTS_MAP[impactType] ?? 3), timeDecayedRate }
  })
}

/** Returns a map of repoId → { prUrl, taskId, queuedAt } for repos with open agent PRs */
async function getOpenAgentPRMap(): Promise<Map<number, { prUrl: string; taskId: string; queuedAt: Date }>> {
  const events = await db.query.portfolioEvents.findMany({
    where: and(
      eq(schema.portfolioEvents.userId, USER_ID!),
      inArray(schema.portfolioEvents.eventType, ['agent_pr_created', 'agent_pr_merged', 'agent_task_queued']),
    ),
    columns: { repoId: true, eventType: true, metadata: true, occurredAt: true },
    orderBy: [desc(schema.portfolioEvents.occurredAt)],
  })

  const mergedTaskIds = new Set<string>()
  for (const e of events) {
    if (e.eventType === 'agent_pr_merged') {
      const meta = e.metadata as { taskId?: string } | null
      if (meta?.taskId) mergedTaskIds.add(meta.taskId)
    }
  }

  const result = new Map<number, { prUrl: string; taskId: string; queuedAt: Date }>()
  for (const e of events) {
    if (e.eventType === 'agent_pr_created' && e.repoId != null) {
      const meta = e.metadata as { taskId?: string; prUrl?: string } | null
      if (meta?.taskId && !mergedTaskIds.has(meta.taskId) && !result.has(e.repoId)) {
        result.set(e.repoId, { prUrl: meta.prUrl ?? '', taskId: meta.taskId, queuedAt: e.occurredAt })
      }
    }
  }
  return result
}

/** Returns set of (repoId + actionKey) combos that have failed 2+ times */
async function getDeadEndActions(): Promise<Set<string>> {
  const attempts = await db.query.portfolioEvents.findMany({
    where: and(
      eq(schema.portfolioEvents.userId, USER_ID!),
      eq(schema.portfolioEvents.eventType, 'agent_attempt'),
    ),
    columns: { repoId: true, metadata: true },
  })

  // Count failures per (repoId, action)
  const failCounts = new Map<string, number>()
  for (const a of attempts) {
    const meta = a.metadata as { action?: string; outcome?: string } | null
    if (meta?.outcome === 'failed' && a.repoId != null && meta.action) {
      const key = `${a.repoId}::${meta.action.toLowerCase().slice(0, 60)}`
      failCounts.set(key, (failCounts.get(key) ?? 0) + 1)
    }
  }

  const deadEnds = new Set<string>()
  for (const [key, count] of failCounts) {
    if (count >= 2) deadEnds.add(key)
  }
  return deadEnds
}

function gradeLabel(score: number): string {
  if (score >= 90) return 'A — Excellent'
  if (score >= 80) return 'B — Great'
  if (score >= 70) return 'C — Good'
  if (score >= 60) return 'D — Fair'
  return 'F — Needs Work'
}

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err instanceof Error ? err.message : err}\n`)
  process.exit(1)
})
