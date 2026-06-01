import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { portfolioEvents } from '@/lib/db/schema'
import { eq, and, gte, lt, asc } from 'drizzle-orm'

export async function GET(request: Request) {
  const session = await auth()
  if (!session?.user?.id) return new Response('Unauthorized', { status: 401 })

  const url = new URL(request.url)
  const yearParam = url.searchParams.get('year')
  const year = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear()
  if (isNaN(year)) return new Response('Invalid year', { status: 400 })

  const events = await db.query.portfolioEvents.findMany({
    where: and(
      eq(portfolioEvents.userId, session.user.id),
      gte(portfolioEvents.occurredAt, new Date(`${year}-01-01`)),
      lt(portfolioEvents.occurredAt, new Date(`${year + 1}-01-01`)),
    ),
    with: { repository: { columns: { name: true } } },
    orderBy: [asc(portfolioEvents.occurredAt)],
  })

  const lines: string[] = [
    `# Portfolio Changelog ${year}`,
    '',
    `_Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}_`,
    '',
  ]

  let currentMonth = ''
  for (const event of events) {
    const month = new Date(event.occurredAt).toLocaleString('en-US', { month: 'long', year: 'numeric' })
    if (month !== currentMonth) {
      if (currentMonth !== '') lines.push('')
      lines.push(`## ${month}`, '')
      currentMonth = month
    }

    const dateStr = new Date(event.occurredAt).toISOString().split('T')[0]
    const repoLabel = event.repository?.name ? ` (**${event.repository.name}**)` : ''
    const typeLabel = EVENT_LABELS[event.eventType] ?? event.eventType
    lines.push(`- \`${dateStr}\` [${typeLabel}]${repoLabel} ${event.title}`)
    if (event.description) lines.push(`  > ${event.description}`)
  }

  if (events.length === 0) {
    lines.push('_No events recorded for this year._')
  }

  const markdown = lines.join('\n')
  return new Response(markdown, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="changelog-${year}.md"`,
    },
  })
}

const EVENT_LABELS: Record<string, string> = {
  repo_created:     'New Repo',
  repo_archived:    'Archived',
  mrr_changed:      'Revenue',
  health_milestone: 'Health',
  first_revenue:    'First Revenue',
  manual_milestone: 'Milestone',
}
