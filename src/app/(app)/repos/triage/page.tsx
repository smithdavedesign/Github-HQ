import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { repositories } from '@/lib/db/schema'
import { eq, and, notInArray } from 'drizzle-orm'
import { TriageView } from '@/components/repos/triage-view'
import type { TriageRepo } from '@/components/repos/triage-view'

export default async function TriagePage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

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

  // Sort by archive score descending — most archive-worthy first
  const sorted = [...rows]
    .filter(r => r.metrics != null)
    .sort((a, b) => (b.metrics!.archiveScore ?? 0) - (a.metrics!.archiveScore ?? 0))

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
        <h1 className="text-2xl font-bold tracking-tight">Triage</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Review your repos and decide: keep, sunset, archive, or skip.
          Sorted by archive risk — highest first.
        </p>
      </div>
      <TriageView repos={triageRepos} />
    </div>
  )
}
