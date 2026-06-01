import Anthropic from '@anthropic-ai/sdk'
import { db } from '@/lib/db'
import { digests, repositories, repositoryMetrics, securityFindings, deployments } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'

const client = new Anthropic()

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CeoReportWin {
  repoName: string
  achievement: string   // e.g. "gained 4 stars", "100% uptime this week", "health +12"
}

export interface CeoReportRisk {
  repoName: string
  repoId: number
  risk: string          // e.g. "failing builds for 3 days", "dormant 90 days"
  urgency: 'critical' | 'high' | 'medium'
}

export interface CeoReportFocus {
  rank: number
  repoName: string
  repoId: number
  rationale: string     // e.g. "+$500 opportunity if health improved"
}

export interface CeoReportContent {
  portfolioSummary: {
    totalValueUsd: number
    mrr: number
    mrrDelta: number          // vs previous week (0 if unknown)
    avgHealth: number
    avgHealthDelta: number    // vs previous week (0 if unknown)
    repoCount: number
  }
  biggestWins: CeoReportWin[]        // top 3
  biggestRisks: CeoReportRisk[]      // top 3
  recommendedFocus: CeoReportFocus[] // top 3
  closingLine: string                // 1 sentence — the single most important thing
  generatedAt: string
}

// ─── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a Chief of Staff summarising a software portfolio for a solo developer / indie hacker.
Given portfolio statistics and a list of repositories with recent metrics, produce a concise executive briefing.

Return ONLY valid JSON matching this structure — no markdown, no explanation outside the JSON:
{
  "biggestWins": [
    { "repoName": "...", "achievement": "short phrase, max 60 chars" }
  ],
  "biggestRisks": [
    { "repoName": "...", "repoId": 0, "risk": "short phrase, max 80 chars", "urgency": "critical|high|medium" }
  ],
  "recommendedFocus": [
    { "rank": 1, "repoName": "...", "repoId": 0, "rationale": "short phrase, max 80 chars" }
  ],
  "closingLine": "single most important thing to do this week (1 sentence)"
}

Rules:
- Exactly 3 items in each array
- biggestWins: celebrate real positives (uptime, stars, health gains, new revenue)
- biggestRisks: flag real problems (failing builds, security alerts, dormant revenue repos, down deployments)
- recommendedFocus: rank by value impact — revenue repos first, then security, then health
- Be specific: name the repo, quantify where possible
- Tone: direct, brief, no fluff`

// ─── Generator ────────────────────────────────────────────────────────────────

export async function generateCeoReport(userId: string): Promise<CeoReportContent> {
  const userRepos = await db.query.repositories.findMany({
    where: eq(repositories.userId, userId),
    with: {
      metrics: true,
      deployments: true,
      securityFindings: { where: eq(securityFindings.state, 'open') },
    },
    columns: {
      id: true, name: true, mrr: true, stars: true,
      isRevenueGenerating: true, lifecycleStatus: true,
    },
  })

  if (userRepos.length === 0) throw new Error('No repositories to analyse')

  // ── Portfolio summary (computed from DB, not Claude) ──────────────────────
  const totalMrr = userRepos.reduce((s, r) => s + parseFloat(String(r.mrr ?? '0')), 0)
  const healthScores = userRepos.map(r => r.metrics?.healthScore ?? 0).filter(Boolean)
  const avgHealth = healthScores.length
    ? healthScores.reduce((s, h) => s + h, 0) / healthScores.length
    : 0
  const totalValue = userRepos.reduce((s, r) => s + (r.metrics?.estimatedValue ?? 0), 0)

  // ── Build a compact snapshot for Claude ──────────────────────────────────
  const repoLines = userRepos.map(r => {
    const m = r.metrics
    const criticalSec = r.securityFindings.filter(
      f => f.severity === 'critical' || f.severity === 'high',
    ).length
    const deployStatus = r.deployments.find(d => d.status === 'down')
      ? 'DOWN'
      : r.deployments.find(d => d.status === 'slow')
        ? 'SLOW'
        : r.deployments.length > 0
          ? 'healthy'
          : 'none'

    const daysSincePush = m?.lastPush
      ? Math.floor((Date.now() - new Date(m.lastPush).getTime()) / 86_400_000)
      : 999

    return [
      `[${r.id}] ${r.name}`,
      `health=${m?.healthScore?.toFixed(0) ?? '?'}`,
      `activity=${m?.activityStatus ?? 'unknown'}`,
      `build=${m?.buildStatus ?? 'unknown'}`,
      `deploy=${deployStatus}`,
      `security=${criticalSec} critical/high`,
      `mrr=$${parseFloat(String(r.mrr ?? '0')).toFixed(0)}`,
      `stars=${r.stars ?? 0}`,
      `days_since_push=${daysSincePush}`,
      `lifecycle=${r.lifecycleStatus ?? 'maintaining'}`,
      `opp=${m?.opportunityScore?.toFixed(0) ?? '?'}`,
    ].join(' ')
  }).join('\n')

  const prompt = `Portfolio: ${userRepos.length} repos · MRR $${totalMrr.toFixed(0)} · avg health ${avgHealth.toFixed(0)}/100 · total value $${totalValue.toLocaleString()}\n\n${repoLines}`

  const message = await client.messages.create({
    model: 'claude-haiku-4-5',
    max_tokens: 1024,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: prompt }],
  })

  const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '{}'
  const jsonStr = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')

  type ClaudeOutput = {
    biggestWins: CeoReportWin[]
    biggestRisks: CeoReportRisk[]
    recommendedFocus: CeoReportFocus[]
    closingLine: string
  }
  const parsed = JSON.parse(jsonStr) as ClaudeOutput

  const result: CeoReportContent = {
    portfolioSummary: {
      totalValueUsd: totalValue,
      mrr: totalMrr,
      mrrDelta: 0,      // future: compare to last week's digest
      avgHealth: Math.round(avgHealth),
      avgHealthDelta: 0,
      repoCount: userRepos.length,
    },
    biggestWins: parsed.biggestWins ?? [],
    biggestRisks: parsed.biggestRisks ?? [],
    recommendedFocus: parsed.recommendedFocus ?? [],
    closingLine: parsed.closingLine ?? '',
    generatedAt: new Date().toISOString(),
  }

  // ── Upsert into the most recent digest row for this user ─────────────────
  const latest = await db.query.digests.findFirst({
    where: eq(digests.userId, userId),
    orderBy: [desc(digests.generatedAt)],
    columns: { id: true },
  })

  if (latest) {
    await db.update(digests).set({ ceoReport: result }).where(eq(digests.id, latest.id))
  } else {
    // No digest yet — store a stub digest row so the ceoReport is retrievable
    await db.insert(digests).values({
      userId,
      content: { summary: '', priorities: [], generatedAt: new Date().toISOString() },
      ceoReport: result,
    })
  }

  return result
}

// ─── Query ────────────────────────────────────────────────────────────────────

export async function getLatestCeoReport(userId: string): Promise<CeoReportContent | null> {
  const latest = await db.query.digests.findFirst({
    where: eq(digests.userId, userId),
    orderBy: [desc(digests.generatedAt)],
    columns: { ceoReport: true, generatedAt: true },
  })

  if (!latest?.ceoReport) return null

  // Expire after 8 days (same policy as weekly briefing)
  const age = Date.now() - new Date(latest.generatedAt!).getTime()
  if (age > 8 * 24 * 60 * 60 * 1000) return null

  return latest.ceoReport as CeoReportContent
}
