import { toNum } from '@/lib/utils'
import { getLLMAdapter } from './adapter'
import { db } from '@/lib/db'
import { repositories, repositoryMetrics, securityFindings, deployments, digests } from '@/lib/db/schema'
import { eq, inArray, and } from 'drizzle-orm'
import {
  calculateOpportunityScore,
  calculateRevenuePotential,
  calculateTrafficScore,
} from '@/lib/health/scoring'
import { formatValuation } from '@/lib/health/valuation'


export interface AdvisorAction {
  repoId: number
  repoName: string
  action: string            // imperative sentence starting with a verb
  impactType: 'opportunity' | 'revenue' | 'security' | 'health'
  estimatedImpact: string   // e.g. "+14 opportunity points" or "$200/mo MRR"
  effort: 'quick' | 'medium' | 'substantial'
  reasoning: string         // 1 sentence why this matters
}

export interface AdvisorContent {
  headline: string                // 1 sentence — the single biggest lever
  actions: AdvisorAction[]        // top 5, sorted by impact
  portfolioInsight: string        // 2-3 sentences on trajectory
  totalValueUnlocked: string      // e.g. "+$18,000 estimated value if all actions taken"
  generatedAt: string
}

/**
 * Pre-compute the opportunity score delta for common improvements on a repo.
 * Returns how many points the score would improve for each scenario.
 */
function computeOpportunityDeltas(repo: {
  healthScore: number
  activityScore: number
  securityScore: number
  stars: number
  mrr: number
  hasLiveDeployment: boolean
  isRevenueGenerating: boolean
  openCriticalFindings: number
}) {
  const base = calculateOpportunityScore({
    healthScore: repo.healthScore,
    activityScore: repo.activityScore,
    stars: repo.stars,
    mrr: repo.mrr,
    isRevenueGenerating: repo.isRevenueGenerating,
    hasLiveDeployment: repo.hasLiveDeployment,
  })

  // Delta: if we add a live deployment
  const withDeploy = repo.hasLiveDeployment ? null : calculateOpportunityScore({
    ...repo, hasLiveDeployment: true,
  }) - base

  // Delta: if security is fully fixed (score goes to 100)
  const withSecurity = repo.openCriticalFindings === 0 ? null : (() => {
    // Security affects health score (20% weight), which affects opportunity (25% weight)
    const newHealth = Math.min(100, repo.healthScore + repo.openCriticalFindings * 5)
    return calculateOpportunityScore({ ...repo, healthScore: newHealth }) - base
  })()

  // Delta: if activity picks up (score goes from current to 60)
  const withActivity = repo.activityScore >= 60 ? null : calculateOpportunityScore({
    ...repo, activityScore: 60,
  }) - base

  // Delta: if we add $100/mo MRR to a non-revenue repo
  const withRevenue = repo.mrr > 0 ? null : calculateOpportunityScore({
    ...repo, mrr: 100, isRevenueGenerating: true,
  }) - base

  return { base, withDeploy, withSecurity, withActivity, withRevenue }
}

export async function generateAdvisor(userId: string): Promise<AdvisorContent> {
  const userRepos = await db.query.repositories.findMany({
    where: eq(repositories.userId, userId),
    with: {
      metrics: true,
      deployments: true,
      securityFindings: { where: eq(securityFindings.state, 'open') },
    },
    columns: {
      id: true, name: true, description: true, stars: true,
      mrr: true, isRevenueGenerating: true, isArchived: true, lifecycleStatus: true, purpose: true,
    },
  })

  if (userRepos.length === 0) throw new Error('No repos to advise on')

  // Pre-compute opportunity deltas for each non-archived repo
  const graveyardRepos = await db.query.repositories.findMany({
    where: and(eq(repositories.userId, userId), inArray(repositories.lifecycleStatus, ['archived', 'sunsetting'])),
    columns: { name: true, abandonmentReason: true, description: true },
  })

  const repoAnalysis = userRepos
    .filter(r => !r.isArchived && r.metrics && r.purpose !== 'Reference')
    .map(r => {
      const m = r.metrics!
      const mrrNum = toNum(r.mrr)
      const hasLiveDeploy = r.deployments.some(d => d.status === 'healthy' || d.status === 'slow')
      const openCritical = r.securityFindings.filter(f => f.severity === 'critical' || f.severity === 'high').length

      const deltas = computeOpportunityDeltas({
        healthScore: m.healthScore ?? 0,
        activityScore: m.activityScore ?? 0,
        securityScore: m.securityScore ?? 100,
        stars: r.stars ?? 0,
        mrr: mrrNum,
        hasLiveDeployment: hasLiveDeploy,
        isRevenueGenerating: r.isRevenueGenerating ?? false,
        openCriticalFindings: openCritical,
      })

      return {
        id: r.id,
        name: r.name,
        description: r.description,
        stars: r.stars ?? 0,
        mrr: mrrNum,
        lifecycle: r.lifecycleStatus,
        healthScore: Math.round(m.healthScore ?? 0),
        activityScore: Math.round(m.activityScore ?? 0),
        securityScore: Math.round(m.securityScore ?? 100),
        opportunityScore: Math.round(m.opportunityScore ?? 0),
        estimatedValue: m.estimatedValue ?? 0,
        hasLiveDeploy,
        openCritical,
        activityStatus: m.activityStatus,
        buildStatus: m.buildStatus,
        deltas,
      }
    })
    .sort((a, b) => b.opportunityScore - a.opportunityScore)

  // Build a compact, data-rich prompt
  const totalValue = userRepos.reduce((sum, r) => sum + (r.metrics?.estimatedValue ?? 0), 0)
  const avgOpp = Math.round(repoAnalysis.reduce((sum, r) => sum + r.opportunityScore, 0) / repoAnalysis.length)

  const repoLines = repoAnalysis.slice(0, 20).map(r => {
    const deltaLines: string[] = []
    if (r.deltas.withDeploy !== null && r.deltas.withDeploy > 0) deltaLines.push(`+${r.deltas.withDeploy}pts if deployed`)
    if (r.deltas.withSecurity !== null && r.deltas.withSecurity > 0) deltaLines.push(`+${r.deltas.withSecurity}pts if security fixed`)
    if (r.deltas.withActivity !== null && r.deltas.withActivity > 0) deltaLines.push(`+${r.deltas.withActivity}pts if active`)
    if (r.deltas.withRevenue !== null && r.deltas.withRevenue > 0) deltaLines.push(`+${r.deltas.withRevenue}pts if $100 MRR`)

    return [
      `[${r.id}] ${r.name} (opp=${r.opportunityScore} health=${r.healthScore} act=${r.activityScore} sec=${r.securityScore})`,
      `  mrr=$${r.mrr} stars=${r.stars} lifecycle=${r.lifecycle} build=${r.buildStatus ?? 'none'}`,
      `  ${r.openCritical} critical/high security alerts  deployed=${r.hasLiveDeploy}`,
      deltaLines.length ? `  GAINS: ${deltaLines.join(', ')}` : '  no easy gains detected',
    ].join('\n')
  }).join('\n\n')

  const graveyardSection = graveyardRepos.length > 0
    ? `\n\nGRAVEYARD — ideas already abandoned (avoid recommending the same direction):\n${graveyardRepos.map(r => `- ${r.name}${r.abandonmentReason ? ` (reason: ${r.abandonmentReason})` : ''}${r.description ? ` — ${r.description}` : ''}`).join('\n')}`
    : ''

  const SYSTEM_PROMPT = `You are a senior portfolio advisor for a solo developer. Given pre-computed opportunity score data for their repos, identify the top 5 specific actions to take to maximize portfolio value.

Each action must reference the EXACT opportunity score gain shown in the GAINS field — do not invent numbers. Use the repo ID and name from the data.${graveyardSection}

Return ONLY valid JSON (no markdown):
{
  "headline": "one-sentence — the single highest-leverage move in the whole portfolio",
  "actions": [
    {
      "repoId": 123,
      "repoName": "exact-repo-name",
      "action": "verb phrase — specific action in 10-15 words",
      "impactType": "opportunity | revenue | security | health",
      "estimatedImpact": "use exact delta from GAINS data, e.g. +14 opportunity score points",
      "effort": "quick | medium | substantial",
      "reasoning": "1 sentence — why this matters more than alternatives"
    }
  ],
  "portfolioInsight": "2-3 sentences on portfolio trajectory and biggest pattern you see",
  "totalValueUnlocked": "e.g. Completing all actions above could add ~X opportunity points"
}

Rules:
- Only reference GAINS deltas that are > 0
- Prioritise: revenue additions > security fixes > deployment > activity
- effort: quick = <30min, medium = 1-4h, substantial = 1+ days
- Skip repos with no GAINS lines
- Pick the 5 highest-delta actions across all repos
- If a recommended action resembles a graveyard idea, add a caveat in the reasoning field`

  const adapter = await getLLMAdapter(userId)
  const text = await adapter.generate({
    system: SYSTEM_PROMPT,
    user: `Portfolio: ${repoAnalysis.length} repos, avg opp score ${avgOpp}, estimated total value ${formatValuation(totalValue)}\n\n${repoLines}`,
    fast: false,
    maxTokens: 1500,
    cacheSystem: true,
  })
  const jsonStr = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  let parsed: Omit<AdvisorContent, 'generatedAt'>
  try {
    parsed = JSON.parse(jsonStr)
  } catch {
    console.error('[advisor] failed to parse Claude response:', text.slice(0, 200))
    throw new Error('Advisor: Claude returned non-JSON response')
  }

  const result: AdvisorContent = { ...parsed, generatedAt: new Date().toISOString() }

  // Store in the most recent digest record, or create a stub
  const latestDigest = await db.query.digests.findFirst({
    where: eq(digests.userId, userId),
    orderBy: (d, { desc }) => [desc(d.generatedAt)],
  })

  if (latestDigest) {
    await db.update(digests)
      .set({ advisorContent: result })
      .where(eq(digests.id, latestDigest.id))
  } else {
    // No digest yet — create a stub record to hold the advisor content
    await db.insert(digests).values({
      userId,
      content: { summary: '', priorities: [], generatedAt: new Date().toISOString() },
      advisorContent: result,
    })
  }

  return result
}

export async function getLatestAdvisor(userId: string): Promise<AdvisorContent | null> {
  const latest = await db.query.digests.findFirst({
    where: eq(digests.userId, userId),
    orderBy: (d, { desc }) => [desc(d.generatedAt)],
    columns: { advisorContent: true, generatedAt: true },
  })
  if (!latest?.advisorContent) return null

  // Return if generated within 8 days
  const age = Date.now() - (latest.generatedAt?.getTime() ?? 0)
  if (age > 8 * 24 * 60 * 60 * 1000) return null

  return latest.advisorContent as AdvisorContent
}
