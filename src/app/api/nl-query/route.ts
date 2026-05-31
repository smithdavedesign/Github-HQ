import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()

export interface NLQueryFilters {
  healthMin?: number
  healthMax?: number
  activityStatus?: string[]          // 'Actively Maintained' | 'Low Activity' | 'Dormant' | 'Abandoned'
  lastPushBeforeDays?: number        // repos not pushed to in N days
  lastPushAfterDays?: number         // repos pushed to within N days
  visibility?: 'public' | 'private'
  language?: string                  // exact language name, e.g. "TypeScript"
  framework?: string                 // e.g. "Next.js", "React"
  database?: string                  // e.g. "PostgreSQL"
  isRevenueGenerating?: boolean
  hasSecurityIssues?: boolean        // has open critical or high alerts
  starsMin?: number
  mrrMin?: number
  sortBy?: 'health' | 'activity' | 'security' | 'lastPush' | 'stars' | 'mrr' | 'name'
  sortDir?: 'asc' | 'desc'
}

export interface NLQueryResult {
  filters: NLQueryFilters
  explanation: string  // human-readable summary of what was filtered
}

const SYSTEM_PROMPT = `You translate natural language questions about a GitHub portfolio into structured filter specifications.

Available filter fields (only include fields relevant to the question):
- healthMin / healthMax: number 0-100 (health score range)
- activityStatus: array of "Actively Maintained" | "Low Activity" | "Dormant" | "Abandoned"
- lastPushBeforeDays: repos NOT updated in this many days (e.g. 180 for "6 months")
- lastPushAfterDays: repos updated WITHIN this many days
- visibility: "public" | "private"
- language: primary programming language (exact string, e.g. "TypeScript")
- framework: detected frontend framework (e.g. "Next.js", "React", "Vue")
- database: detected database (e.g. "PostgreSQL", "MongoDB")
- isRevenueGenerating: true | false
- hasSecurityIssues: true (has open critical or high severity alerts)
- starsMin: minimum star count
- mrrMin: minimum monthly revenue in dollars
- sortBy: "health" | "activity" | "security" | "lastPush" | "stars" | "mrr" | "name"
- sortDir: "asc" | "desc"

Return ONLY valid JSON — no markdown, no explanation:
{
  "filters": { ...only the relevant fields... },
  "explanation": "plain English: what this filter shows (max 15 words)"
}

Examples:
Q: "which repos haven't been touched in 6 months"
→ { "filters": { "lastPushBeforeDays": 180, "sortBy": "lastPush", "sortDir": "asc" }, "explanation": "Repos not updated in the last 6 months, oldest first" }

Q: "show me my Next.js projects"
→ { "filters": { "framework": "Next.js" }, "explanation": "Repos using Next.js framework" }

Q: "repos that need attention — bad health or security issues"
→ { "filters": { "healthMax": 70 }, "explanation": "Repos with health score below 70" }

Q: "private repos I haven't worked on recently"
→ { "filters": { "visibility": "private", "activityStatus": ["Dormant", "Abandoned"], "sortBy": "lastPush", "sortDir": "asc" }, "explanation": "Dormant or abandoned private repos" }`

export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const question: string = body.question?.trim() ?? ''

  if (!question || question.length < 3) {
    return NextResponse.json({ error: 'Question too short' }, { status: 400 })
  }

  if (question.length > 300) {
    return NextResponse.json({ error: 'Question too long' }, { status: 400 })
  }

  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',  // fast + cheap for this interactive use case
    max_tokens: 256,
    system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: question }],
  })

  const text = message.content[0].type === 'text' ? message.content[0].text.trim() : '{}'
  const jsonStr = text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')

  const result: NLQueryResult = JSON.parse(jsonStr)

  return NextResponse.json(result)
}
