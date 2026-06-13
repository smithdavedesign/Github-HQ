import Link from 'next/link'
import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { repositories } from '@/lib/db/schema'
import { eq, and, notInArray } from 'drizzle-orm'
import { TriageView } from '@/components/repos/triage-view'
import type { TriageRepo } from '@/components/repos/triage-view'

// Only surface repos with meaningful archive risk by default.
// Repos you reviewed and "Kept" that are healthy won't reappear until
// their archive score rises above this threshold again.
const DEFAULT_THRESHOLD = 25

interface PageProps {
  searchParams: Promise<{ all?: string }>
}

export default async function TriagePage({ searchParams }: PageProps) {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const { all } = await searchParams
  const showAll = all === '1'

  const rows = await db.query.repositories.findMany({
    where: and(
      eq(repositories.userId, session.user.id),
      notInArray(repositories.lifecycleStatus, ['archived', 'sunsetting']),
    ),
    with: {
      metrics: {
        columns: { archiveScore: true, healthScore: true, lastPush: true },
      },
    },
    columns: {
      id: true, name: true, description: true, language: true,
      stars: true, lifecycleStatus: true, purpose: true,
    },
    orderBy: (r, { desc }) => [desc(r.updatedAt)],
  })

  const withMetrics = rows.filter(r => r.metrics != null)

  // Default: only show repos above the archive risk threshold
  const candidates = withMetrics.filter(r =>
    showAll || (r.metrics!.archiveScore ?? 0) >= DEFAULT_THRESHOLD
  )

  const hidden = withMetrics.length - candidates.length

  // Sort by archive score descending — most archive-worthy first
  const sorted = [...candidates].sort(
    (a, b) => (b.metrics!.archiveScore ?? 0) - (a.metrics!.archiveScore ?? 0)
  )

  const triageRepos: TriageRepo[] = sorted.map(r => ({
    id: r.id,
    name: r.name,
    description: r.description,
    language: r.language,
    stars: r.stars ?? 0,
    lifecycleStatus: r.lifecycleStatus,
    archiveScore: r.metrics!.archiveScore ?? 0,
    healthScore: r.metrics!.healthScore ?? 0,
    lastPush: r.metrics!.lastPush ?? null,
    purpose: r.purpose,
  }))

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Triage</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {showAll
                ? `All ${withMetrics.length} active repos — sorted by archive risk`
                : `Repos with archive risk ≥ ${DEFAULT_THRESHOLD} — sorted highest first`}
            </p>
          </div>
          {!showAll && hidden > 0 && (
            <Link
              href="/repos/triage?all=1"
              className="text-xs text-muted-foreground hover:text-foreground underline shrink-0 mt-1"
            >
              + {hidden} low-risk hidden
            </Link>
          )}
          {showAll && (
            <Link
              href="/repos/triage"
              className="text-xs text-muted-foreground hover:text-foreground underline shrink-0 mt-1"
            >
              Show candidates only
            </Link>
          )}
        </div>
      </div>
      <TriageView repos={triageRepos} />
    </div>
  )
}
