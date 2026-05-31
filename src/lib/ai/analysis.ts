import Anthropic from '@anthropic-ai/sdk'
import { db } from '@/lib/db'
import { repositories, repositoryMetrics, techStack, securityFindings } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

const client = new Anthropic()

export interface ClaudeAnalysis {
  architecture: {
    summary: string
    strengths: string[]
    concerns: string[]
    pattern: string // e.g. "Monolith", "Serverless", "Microservices"
  }
  security: {
    summary: string
    issues: string[]
    recommendations: string[]
    rating: 'Good' | 'Fair' | 'Poor'
  }
  codeQuality: {
    summary: string
    strengths: string[]
    improvements: string[]
    rating: 'Good' | 'Fair' | 'Poor'
  }
  techDebt: {
    level: 'Low' | 'Medium' | 'High'
    items: string[]
  }
  recommendations: Array<{
    priority: 'High' | 'Medium' | 'Low'
    action: string
    rationale: string
  }>
  overallScore: number // 0-100
  generatedAt: string
}

const SYSTEM_PROMPT = `You are a senior software architect performing a deep repository analysis.
Given repository metadata, return ONLY a valid JSON object matching this exact structure with no markdown:
{
  "architecture": {
    "summary": "2-3 sentence architectural overview",
    "strengths": ["strength 1", "strength 2"],
    "concerns": ["concern 1"],
    "pattern": "Monolith | Serverless | Microservices | Static | Library | CLI | Unknown"
  },
  "security": {
    "summary": "1-2 sentence security posture",
    "issues": ["issue 1"],
    "recommendations": ["recommendation 1"],
    "rating": "Good | Fair | Poor"
  },
  "codeQuality": {
    "summary": "1-2 sentence quality assessment",
    "strengths": ["strength 1"],
    "improvements": ["improvement 1"],
    "rating": "Good | Fair | Poor"
  },
  "techDebt": {
    "level": "Low | Medium | High",
    "items": ["debt item 1"]
  },
  "recommendations": [
    { "priority": "High | Medium | Low", "action": "specific action", "rationale": "why" }
  ],
  "overallScore": 0-100
}
Be specific and actionable. Use the provided data — do not invent facts not supported by the input.`

export async function analyzeRepository(repoId: number): Promise<ClaudeAnalysis> {
  const repo = await db.query.repositories.findFirst({
    where: eq(repositories.id, repoId),
    with: {
      metrics: true,
      techStack: true,
      securityFindings: { where: eq(securityFindings.state, 'open') },
      deployments: true,
    },
  })

  if (!repo) throw new Error('Repository not found')

  const stack = repo.techStack
  const metrics = repo.metrics
  const openFindings = repo.securityFindings ?? []

  const securitySummary = openFindings.length === 0
    ? 'No open security alerts'
    : openFindings.map(f => `${f.severity}: ${f.title}`).join(', ')

  const prompt = `Analyze this repository:

Name: ${repo.name}
Description: ${repo.description ?? 'None'}
Language: ${repo.language ?? 'Unknown'}
Visibility: ${repo.visibility}
Archived: ${repo.isArchived}
Fork: ${repo.isFork}
Stars: ${repo.stars} | Forks: ${repo.forks}

Tech Stack:
- Frontend: ${stack?.frontend ?? 'N/A'}
- Backend: ${stack?.backend ?? 'N/A'}
- Database: ${stack?.database ?? 'N/A'}
- Hosting: ${stack?.hosting ?? 'N/A'}
- Language: ${stack?.language ?? 'N/A'}
- Testing: ${stack?.testing ?? 'None detected'}
- CI/CD: ${stack?.ciCd ?? 'None detected'}
- Analytics: ${stack?.analytics ?? 'N/A'}
- AI Tools: ${stack?.aiTools ?? 'N/A'}

Activity:
- Status: ${metrics?.activityStatus ?? 'Unknown'}
- Monthly commits: ${metrics?.monthlyCommits ?? 0}
- Quarterly commits: ${metrics?.quarterlyCommits ?? 0}
- Open issues: ${metrics?.openIssues ?? 0}
- Open PRs: ${metrics?.openPrs ?? 0}
- Last push: ${metrics?.lastPush ? new Date(metrics.lastPush).toISOString().split('T')[0] : 'Unknown'}
- Build status: ${metrics?.buildStatus ?? 'Unknown'}

Health Scores:
- Health: ${metrics?.healthScore ?? 0}/100
- Activity: ${metrics?.activityScore ?? 0}/100
- Security: ${metrics?.securityScore ?? 100}/100
- Documentation: ${metrics?.documentationScore ?? 0}/100
- Testing: ${metrics?.testingScore ?? 0}/100

Security:
- Open alerts: ${openFindings.length}
- Details: ${securitySummary}

Deployments: ${repo.deployments.length > 0 ? repo.deployments.map(d => `${d.url} (${d.status})`).join(', ') : 'None configured'}
Revenue generating: ${repo.isRevenueGenerating ? 'Yes' : 'No'}
MRR: $${repo.mrr ?? 0}
Tags: ${(repo.tags ?? []).join(', ') || 'None'}`

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: prompt }],
  })

  const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '{}'

  // Strip any markdown code fences if present
  const jsonStr = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
  const analysis: Omit<ClaudeAnalysis, 'generatedAt'> = JSON.parse(jsonStr)

  const result: ClaudeAnalysis = { ...analysis, generatedAt: new Date().toISOString() }

  await db
    .update(repositories)
    .set({ claudeAnalysis: result, claudeAnalysisAt: new Date() })
    .where(eq(repositories.id, repoId))

  return result
}
