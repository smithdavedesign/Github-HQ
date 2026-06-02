import { db } from '@/lib/db'
import { digests, repositories, repositoryMetrics, securityFindings } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getLLMAdapter } from './adapter'
import { getAccuracyByImpactType, getDowngradedRepos } from '@/lib/actions/advisor-accuracy'

export interface DigestPriority {
  rank: 1 | 2 | 3
  title: string
  repoName: string
  repoId: number
  reason: string
  action: string
  urgency: 'critical' | 'high' | 'medium'
}

export interface DigestContent {
  summary: string
  priorities: DigestPriority[]
  generatedAt: string
}

const SYSTEM_PROMPT = `You are a senior engineering advisor reviewing a developer's GitHub portfolio.
Given a list of repositories with their health metrics, security findings, and activity data, identify the
3 most important things the developer should address this week.

Return ONLY valid JSON matching this structure exactly — no markdown, no explanation outside the JSON:
{
  "summary": "1-2 sentence overview of portfolio health",
  "priorities": [
    {
      "rank": 1,
      "title": "short action title (max 60 chars)",
      "repoName": "exact repository name",
      "repoId": 0,
      "reason": "why this is important right now (1-2 sentences)",
      "action": "specific concrete action to take (1 sentence, starts with a verb)",
      "urgency": "critical | high | medium"
    }
  ]
}

Rules:
- Exactly 3 priorities, ranked 1-3
- Prefer critical security issues > broken deployments > very low health scores > dormant high-value repos
- Be specific — name the repo, name the package, name the problem
- "action" must be actionable in under 30 minutes if possible
- If portfolio is healthy, focus on highest-leverage improvements`

export async function generateDigest(userId: string): Promise<DigestContent> {
  const userRepos = await db.query.repositories.findMany({
    where: eq(repositories.userId, userId),
    with: {
      metrics: true,
      securityFindings: { where: eq(securityFindings.state, 'open') },
      deployments: true,
    },
    columns: {
      id: true, name: true, visibility: true, description: true,
      language: true, isRevenueGenerating: true, mrr: true, stars: true,
    },
  })

  if (userRepos.length === 0) throw new Error('No repositories to analyze')

  // Build a compact portfolio snapshot for the prompt
  const repoLines = userRepos.map(repo => {
    const m = repo.metrics
    const secCount = repo.securityFindings.length
    const criticalSec = repo.securityFindings.filter(f => f.severity === 'critical' || f.severity === 'high').length
    const depStatus = repo.deployments.find(d => d.status === 'down')
      ? 'DOWN'
      : repo.deployments.find(d => d.status === 'slow')
        ? 'SLOW'
        : repo.deployments.length > 0 ? 'healthy' : 'none'

    return [
      `[${repo.id}] ${repo.name}`,
      `  health=${m?.healthScore?.toFixed(0) ?? '?'}`,
      `  activity=${m?.activityStatus ?? 'unknown'}`,
      `  security=${secCount} alerts (${criticalSec} critical/high)`,
      `  build=${m?.buildStatus ?? 'unknown'}`,
      `  deploy=${depStatus}`,
      `  revenue=${repo.isRevenueGenerating ? `$${repo.mrr ?? 0}/mo` : 'no'}`,
      `  last_push=${m?.lastPush ? new Date(m.lastPush).toISOString().split('T')[0] : 'never'}`,
    ].join(' ')
  }).join('\n')

  const avgHealth = userRepos
    .filter(r => r.metrics?.healthScore != null)
    .reduce((sum, r) => sum + (r.metrics!.healthScore ?? 0), 0) / (userRepos.length || 1)

  const prompt = `Portfolio: ${userRepos.length} repos, avg health ${avgHealth.toFixed(0)}/100\n\n${repoLines}`

  const adapter = await getLLMAdapter(userId)
  const text = await adapter.generate({
    system: SYSTEM_PROMPT, user: prompt, fast: false, maxTokens: 1024, cacheSystem: true,
  })
  const jsonStr = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  let parsed: Omit<DigestContent, 'generatedAt'>
  try {
    parsed = JSON.parse(jsonStr)
  } catch {
    console.error('[digest] failed to parse LLM response:', text.slice(0, 200))
    throw new Error('Digest: Claude returned non-JSON response')
  }

  const result: DigestContent = { ...parsed, generatedAt: new Date().toISOString() }

  // On the first Monday of each month, include advisor accuracy in the digest
  const now = new Date()
  const isFirstMonday = now.getDay() === 1 && now.getDate() <= 7
  let advisorAccuracy: object | null = null
  if (isFirstMonday) {
    const [accuracyStats, downgraded] = await Promise.all([
      getAccuracyByImpactType(userId),
      getDowngradedRepos(userId),
    ])
    const withData = accuracyStats.filter(s => s.dataPoints > 0)
    if (withData.length > 0) {
      advisorAccuracy = {
        generatedAt: now.toISOString(),
        stats: accuracyStats,
        downgradedRepos: downgraded,
        summary: withData.map(s =>
          s.hasSignal
            ? `${s.impactType}: ${s.successRate}% accuracy (${s.dataPoints} runs, avg +${s.avgActualDelta} pts)`
            : `${s.impactType}: building signal (${s.dataPoints} runs)`
        ).join('; '),
      }
    }
  }

  // Store in DB — advisorAccuracy is null unless first Monday of month
  await db.insert(digests).values({
    userId,
    content: advisorAccuracy ? { ...result, advisorAccuracy } : result,
  })

  return result
}

export async function getLatestDigest(userId: string): Promise<DigestContent | null> {
  const latest = await db.query.digests.findFirst({
    where: eq(digests.userId, userId),
    orderBy: (d, { desc }) => [desc(d.generatedAt)],
  })

  if (!latest) return null

  // Only return if generated in the last 8 days
  const age = Date.now() - (latest.generatedAt?.getTime() ?? 0)
  if (age > 8 * 24 * 60 * 60 * 1000) return null

  return latest.content as DigestContent
}
