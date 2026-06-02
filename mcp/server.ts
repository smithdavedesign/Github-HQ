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

        // Fetch last 3 session logs for this repo
        const recentSessions = await db.query.portfolioEvents.findMany({
          where: and(
            eq(schema.portfolioEvents.userId, USER_ID),
            eq(schema.portfolioEvents.repoId, repo.id),
            eq(schema.portfolioEvents.eventType, 'session_complete'),
          ),
          orderBy: [desc(schema.portfolioEvents.occurredAt)],
          limit: 3,
        })

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

        lines.push(`_Use \`log_session_complete\` when done to record what you accomplished._`)

        return { content: [{ type: 'text', text: lines.join('\n') }] }
      }

      case 'get_next_action': {
        const [repos, latestDigest] = await Promise.all([
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
        ])

        const advisor = latestDigest?.advisorContent as {
          headline?: string
          actions?: Array<{ repoId: number; repoName: string; action: string; estimatedImpact: string; effort: string; reasoning: string }>
        } | null

        // Pick the top advisor action on an active, non-Reference repo
        const SKIP_PURPOSES = new Set(['Reference', 'Infrastructure'])
        const topAction = advisor?.actions?.find(a => {
          const repo = repos.find(r => r.id === a.repoId)
          if (!repo) return false
          if (repo.isArchived || ['archived', 'sunsetting'].includes(repo.lifecycleStatus ?? '')) return false
          if (SKIP_PURPOSES.has(repo.purpose ?? '')) return false
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
        const lines = [
          `# Next Action`,
          ``,
          `**Repo:** ${topAction.repoName}${repo?.isFocused ? ' ⭐' : ''}`,
          `**Action:** ${topAction.action}`,
          `**Impact:** ${topAction.estimatedImpact}`,
          `**Effort:** ${topAction.effort}`,
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

      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true }
  }
})

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
