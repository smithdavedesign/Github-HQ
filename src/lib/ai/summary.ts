import Anthropic from '@anthropic-ai/sdk'
import { db } from '@/lib/db'
import { repositories } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const client = new Anthropic()

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

export async function generateRepoSummary(
  repoId: number,
  context: RepoContext,
): Promise<RepoSummary> {
  const prompt = `Repository: ${context.name}
Description: ${context.description ?? 'None'}
Language: ${context.language ?? 'Unknown'}
Tech Stack: Frontend=${context.frontend ?? 'N/A'}, Backend=${context.backend ?? 'N/A'}, Database=${context.database ?? 'N/A'}, Hosting=${context.hosting ?? 'N/A'}, Testing=${context.testing ?? 'None'}
Activity: ${context.activityStatus}, ${context.openIssues} open issues, ${context.openPrs} open PRs
Health Score: ${context.healthScore}/100
${context.readmeExcerpt ? `README (excerpt): ${context.readmeExcerpt.slice(0, 800)}` : ''}`

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: prompt }],
  })

  const text = message.content[0].type === 'text' ? message.content[0].text : '{}'
  const summary: RepoSummary = JSON.parse(text)

  await db
    .update(repositories)
    .set({ aiSummary: summary, aiSummaryGeneratedAt: new Date() })
    .where(eq(repositories.id, repoId))

  return summary
}

export async function generateSummariesForUser(userId: string): Promise<void> {
  const userRepos = await db.query.repositories.findMany({
    where: eq(repositories.userId, userId),
    with: { metrics: true, techStack: true },
  })

  for (const repo of userRepos) {
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
      })
      // Respect rate limits between repos
      await new Promise((r) => setTimeout(r, 500))
    } catch {
      // Continue even if one repo's summary fails
    }
  }
}
