import { notFound } from 'next/navigation'
import { db } from '@/lib/db'
import { users, repositories, repositoryMetrics, healthScoreHistory, securityFindings } from '@/lib/db/schema'
import { eq, and, gte, lte, avg, count, sql } from 'drizzle-orm'
import { HealthBadge } from '@/components/repos/health-badge'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { GitBranch, TrendingUp, TrendingDown, Minus, Shield, GitFork } from 'lucide-react'
import Link from 'next/link'
import Anthropic from '@anthropic-ai/sdk'
import type { Metadata } from 'next'

export const revalidate = 86400  // 24h cache — reports are historic

type Props = { params: Promise<{ username: string; quarter: string }> }

/** Parse "2026-q2" → { year: 2026, q: 2, start: Date, end: Date, label: "Q2 2026" } */
function parseQuarter(raw: string) {
  const match = raw.match(/^(\d{4})-q([1-4])$/i)
  if (!match) return null
  const year = parseInt(match[1])
  const q = parseInt(match[2]) as 1 | 2 | 3 | 4
  const startMonth = (q - 1) * 3  // 0-indexed months
  const start = new Date(year, startMonth, 1)
  const end = new Date(year, startMonth + 3, 0, 23, 59, 59, 999)
  const labels = ['Q1', 'Q2', 'Q3', 'Q4']
  return { year, q, start, end, label: `${labels[q - 1]} ${year}` }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username, quarter } = await params
  const parsed = parseQuarter(quarter)
  return {
    title: `${username} — ${parsed?.label ?? quarter} Portfolio Report`,
    description: `Quarterly engineering portfolio report for @${username}`,
  }
}

export default async function QuarterlyReportPage({ params }: Props) {
  const { username, quarter } = await params

  const parsed = parseQuarter(quarter)
  if (!parsed) notFound()

  const user = await db.query.users.findFirst({
    where: and(eq(users.githubLogin, username), eq(users.publicProfile, true)),
    columns: { id: true, name: true, image: true, githubLogin: true },
  })
  if (!user) notFound()

  const { start, end, label } = parsed

  // Repos added this quarter
  const reposAdded = await db.query.repositories.findMany({
    where: and(
      eq(repositories.userId, user.id),
      eq(repositories.visibility, 'public'),
      gte(repositories.createdAt, start),
      lte(repositories.createdAt, end),
    ),
    columns: { id: true, name: true, language: true, description: true },
  })

  // All public repos
  const allPublicRepos = await db.query.repositories.findMany({
    where: and(eq(repositories.userId, user.id), eq(repositories.visibility, 'public')),
    with: { metrics: true },
    columns: { id: true, name: true },
  })

  const repoIds = allPublicRepos.map(r => r.id)

  // Health score at start and end of quarter (from history)
  const [startHistory, endHistory] = await Promise.all([
    repoIds.length > 0 ? db
      .select({ avg: avg(healthScoreHistory.healthScore) })
      .from(healthScoreHistory)
      .where(
        and(
          sql`${healthScoreHistory.repoId} = ANY(ARRAY[${sql.raw(repoIds.join(','))}]::int[])`,
          gte(healthScoreHistory.recordedDate, start.toISOString().split('T')[0]),
          lte(healthScoreHistory.recordedDate, new Date(start.getTime() + 7 * 86400_000).toISOString().split('T')[0]),
        )
      ) : Promise.resolve([{ avg: null }]),
    repoIds.length > 0 ? db
      .select({ avg: avg(healthScoreHistory.healthScore) })
      .from(healthScoreHistory)
      .where(
        and(
          sql`${healthScoreHistory.repoId} = ANY(ARRAY[${sql.raw(repoIds.join(','))}]::int[])`,
          gte(healthScoreHistory.recordedDate, new Date(end.getTime() - 7 * 86400_000).toISOString().split('T')[0]),
          lte(healthScoreHistory.recordedDate, end.toISOString().split('T')[0]),
        )
      ) : Promise.resolve([{ avg: null }]),
  ])

  const startAvg = parseFloat(String(startHistory[0]?.avg ?? '0')) || null
  const endAvg = parseFloat(String(endHistory[0]?.avg ?? '0')) || null
  const currentAvg = Math.round(
    allPublicRepos.reduce((s, r) => s + (r.metrics?.healthScore ?? 0), 0) / (allPublicRepos.length || 1)
  )

  // Security findings created this quarter
  const newSecFindings = repoIds.length > 0 ? await db
    .select({ count: count() })
    .from(securityFindings)
    .where(
      and(
        sql`${securityFindings.repoId} = ANY(ARRAY[${sql.raw(repoIds.join(','))}]::int[])`,
        gte(securityFindings.createdAt, start),
        lte(securityFindings.createdAt, end),
      )
    ) : [{ count: 0 }]

  const newAlerts = newSecFindings[0]?.count ?? 0

  const hasHistory = startAvg !== null || endAvg !== null
  const healthDelta = startAvg && endAvg ? Math.round(endAvg - startAvg) : null

  // AI commentary (only if we have meaningful data)
  let aiCommentary: string | null = null
  if (reposAdded.length > 0 || hasHistory) {
    try {
      const client = new Anthropic()
      const msg = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 300,
        messages: [{
          role: 'user',
          content: `Write 3 sentences of engineering portfolio commentary for ${user.name ?? username}'s ${label} report.
Data:
- ${allPublicRepos.length} public repos total
- ${reposAdded.length} new repos added this quarter
- Current avg health: ${currentAvg}/100${healthDelta !== null ? `, changed ${healthDelta > 0 ? '+' : ''}${healthDelta} pts` : ' (no trend data yet)'}
- ${newAlerts} new security alerts this quarter
Be concise, specific, and encouraging. Focus on what's notable.`,
        }],
      })
      aiCommentary = msg.content[0].type === 'text' ? msg.content[0].text : null
    } catch {
      // Non-fatal
    }
  }

  function TrendIcon() {
    if (healthDelta === null) return <Minus className="w-4 h-4 text-muted-foreground" />
    if (healthDelta > 0) return <TrendingUp className="w-4 h-4 text-emerald-500" />
    if (healthDelta < 0) return <TrendingDown className="w-4 h-4 text-red-500" />
    return <Minus className="w-4 h-4 text-muted-foreground" />
  }

  return (
    <div className="min-h-screen page-content">
      <div className="max-w-3xl mx-auto px-6 py-12 space-y-8">

        {/* Header */}
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Link href={`/u/${username}`} className="hover:text-foreground">@{username}</Link>
            <span>/</span>
            <span>Quarterly Report</span>
          </div>
          <h1 className="text-3xl font-bold tracking-tight">{label} Portfolio Report</h1>
          <p className="text-muted-foreground text-sm">
            {start.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} –{' '}
            {end.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
          </p>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: 'Repos', value: allPublicRepos.length, icon: GitFork, color: 'text-indigo-600' },
            { label: 'Avg Health', value: currentAvg, icon: TrendIcon, color: healthDelta !== null && healthDelta >= 0 ? 'text-emerald-600' : 'text-amber-600' },
            { label: 'New This Quarter', value: reposAdded.length, icon: GitFork, color: 'text-blue-600' },
            { label: 'New Alerts', value: newAlerts, icon: Shield, color: newAlerts > 0 ? 'text-red-600' : 'text-emerald-600' },
          ].map(({ label, value, icon: Icon, color }) => (
            <Card key={label} className="card-elevated border-border/60 p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-wide">{label}</p>
              <div className="flex items-center gap-1.5 mt-1">
                <span className={`text-2xl font-bold tabular-nums ${color}`}>{value}</span>
                <Icon />
              </div>
            </Card>
          ))}
        </div>

        {/* Health trend */}
        {hasHistory ? (
          <Card className="card-elevated border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Health Score Trend</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-4 text-sm">
                {startAvg && <div><p className="text-xs text-muted-foreground">Start of quarter</p><p className="text-xl font-bold">{Math.round(startAvg)}</p></div>}
                {startAvg && endAvg && <div className={`flex items-center gap-1 font-semibold ${healthDelta! >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  <TrendIcon />
                  {healthDelta! > 0 ? '+' : ''}{healthDelta}
                </div>}
                {endAvg && <div><p className="text-xs text-muted-foreground">End of quarter</p><p className="text-xl font-bold">{Math.round(endAvg)}</p></div>}
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-dashed border-border/60">
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              Health trend data accumulates over time — check back next quarter for historical comparisons.
            </CardContent>
          </Card>
        )}

        {/* New repos */}
        {reposAdded.length > 0 && (
          <div className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              New Repositories ({reposAdded.length})
            </h2>
            <div className="space-y-2">
              {reposAdded.map(repo => (
                <div key={repo.id} className="flex items-start gap-3 p-3 rounded-lg bg-card border border-border/60">
                  <div>
                    <p className="text-sm font-medium">{repo.name}</p>
                    {repo.description && <p className="text-xs text-muted-foreground mt-0.5">{repo.description}</p>}
                  </div>
                  {repo.language && <Badge variant="secondary" className="text-xs ml-auto shrink-0">{repo.language}</Badge>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* AI Commentary */}
        {aiCommentary && (
          <Card className="bg-indigo-50 dark:bg-indigo-950/30 border-indigo-200 dark:border-indigo-800">
            <CardContent className="py-4">
              <p className="text-xs font-semibold text-indigo-600 dark:text-indigo-400 mb-2 uppercase tracking-wide">AI Commentary</p>
              <p className="text-sm leading-relaxed">{aiCommentary}</p>
            </CardContent>
          </Card>
        )}

        {/* Footer */}
        <div className="flex items-center justify-between text-xs text-muted-foreground pt-4 border-t border-border/40 flex-wrap gap-2">
          <Link href={`/u/${username}`} className="hover:text-foreground">← Back to portfolio</Link>
          <div className="flex items-center gap-1.5">
            <div className="w-4 h-4 rounded bg-indigo-600 flex items-center justify-center">
              <GitBranch className="w-2.5 h-2.5 text-white" />
            </div>
            <span>RepoHQ</span>
          </div>
        </div>
      </div>
    </div>
  )
}
