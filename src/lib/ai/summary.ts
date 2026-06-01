import { getLLMAdapter } from './adapter'
import { db } from '@/lib/db'
import { repositories } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'


const SYSTEM_PROMPT = `You are a senior software engineer performing a concise repository analysis.
Given repository metadata, return a structured JSON summary with exactly these fields:
{
  "what_it_does": "one sentence describing the project's purpose",
  "maturity": "Prototype | Alpha | Beta | Production",
  "risk": "Low | Medium | High",
  "recommendations": ["action 1", "action 2", "action 3"]
}
Be brief and direct. Do not include any text outside the JSON object.`

export interface RepoSummary {
  what_it_does: string
  maturity: 'Prototype' | 'Alpha' | 'Beta' | 'Production'
  risk: 'Low' | 'Medium' | 'High'
  recommendations: string[]
}

interface RepoContext {
  name: string
  description: string | null
  language: string | null
  frontend: string | null
  backend: string | null
  database: string | null
  hosting: string | null
  testing: string | null
  openIssues: number
  openPrs: number
  healthScore: number
  activityStatus: string
  readmeExcerpt?: string
}

import type { LLMAdapter } from './adapter'

export async function generateRepoSummary(
  repoId: number,
  context: RepoContext,
  adapter: LLMAdapter,
): Promise<RepoSummary> {
  const prompt = `Repository: ${context.name}
Description: ${context.description ?? 'None'}
Language: ${context.language ?? 'Unknown'}
Tech Stack: Frontend=${context.frontend ?? 'N/A'}, Backend=${context.backend ?? 'N/A'}, Database=${context.database ?? 'N/A'}, Hosting=${context.hosting ?? 'N/A'}, Testing=${context.testing ?? 'None'}
Activity: ${context.activityStatus}, ${context.openIssues} open issues, ${context.openPrs} open PRs
Health Score: ${context.healthScore}/100
${context.readmeExcerpt ? `README (excerpt): ${context.readmeExcerpt.slice(0, 800)}` : ''}`

  const text = await adapter.generate({
    system: SYSTEM_PROMPT, user: prompt, fast: false, maxTokens: 512, cacheSystem: true,
  })
  let summary: RepoSummary
  try {
    summary = JSON.parse(text)
  } catch {
    console.error('[summary] failed to parse Claude response:', text.slice(0, 200))
    throw new Error('Summary: Claude returned non-JSON response')
  }

  await db
    .update(repositories)
    .set({ aiSummary: summary, aiSummaryGeneratedAt: new Date() })
    .where(eq(repositories.id, repoId))

  return summary
}

export async function generateSummariesForUser(userId: string): Promise<void> {
  const adapter = await getLLMAdapter(userId)
  const userRepos = await db.query.repositories.findMany({
    where: eq(repositories.userId, userId),
    with: { metrics: true, techStack: true },
  })

  for (const repo of userRepos) {
    // Skip if summary is more recent than last push — content hasn't changed
    if (repo.aiSummary && repo.aiSummaryGeneratedAt && repo.metrics?.lastPush) {
      if (new Date(repo.aiSummaryGeneratedAt) >= new Date(repo.metrics.lastPush)) {
        continue
      }
    }

    try {
      await generateRepoSummary(repo.id, {
        name: repo.name,
        description: repo.description,
        language: repo.language,
        frontend: repo.techStack?.frontend ?? null,
        backend: repo.techStack?.backend ?? null,
        database: repo.techStack?.database ?? null,
        hosting: repo.techStack?.hosting ?? null,
        testing: repo.techStack?.testing ?? null,
        openIssues: repo.metrics?.openIssues ?? 0,
        openPrs: repo.metrics?.openPrs ?? 0,
        healthScore: repo.metrics?.healthScore ?? 0,
        activityStatus: repo.metrics?.activityStatus ?? 'unknown',
      }, adapter)
      // Respect rate limits between repos
      await new Promise((r) => setTimeout(r, 500))
    } catch {
      // Continue even if one repo's summary fails
    }
  }
}
