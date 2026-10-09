import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { Sidebar } from '@/components/layout/sidebar'
import { Topbar } from '@/components/layout/topbar'
import { db } from '@/lib/db'
import { users, scans } from '@/lib/db/schema'
import { and, desc, eq } from 'drizzle-orm'
import { syncFailure } from '@/lib/health/sync-health'
import { latestSnapshotDate } from '@/lib/health/history'
import { factoryStaleMessage, snapshotFreshness, staleDataMessage } from '@/lib/health/freshness'
import { StaleDataBanner } from '@/components/layout/stale-data-banner'
import { factoryAccess } from '@/lib/agents/factory-queue'
import { factoryActivity } from '@/lib/agents/factory-activity'
import { factoryStatus } from '@/lib/health/factory-status'
import type { SidebarStatus } from '@/components/layout/nav-items'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const isFactoryOwner = factoryAccess(session.user.id).ok
  const [user, latestSnapshot, factory, recentSyncs] = await Promise.all([
    db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: { lastSyncedAt: true, publicProfile: true, githubLogin: true },
    }),
    latestSnapshotDate(session.user.id).catch(() => null),
    isFactoryOwner ? factoryActivity(db, session.user.id).catch(() => null) : Promise.resolve(null),
    db.select({ status: scans.status, error: scans.error, startedAt: scans.startedAt }).from(scans)
      .where(and(eq(scans.userId, session.user.id), eq(scans.type, 'sync')))
      .orderBy(desc(scans.startedAt)).limit(6)
      .catch(() => []),
  ])
  // Request time is the point: the banner says how old the data is right now.
  const now = new Date()
  const staleMessage = staleDataMessage(snapshotFreshness(latestSnapshot, now))
  const factoryMessage = factoryStaleMessage(factory, now)
  const sync = syncFailure(recentSyncs.map(r => ({ status: r.status, error: r.error, startedAt: (r.startedAt ?? new Date(0)).toISOString() })))
  const syncMessage = sync ? `GitHub sync is failing (${sync.failures} in a row${sync.error ? `: ${sync.error.slice(0, 80)}` : ''}). ${sync.hint.charAt(0).toUpperCase()}${sync.hint.slice(1)}.` : null
  const sidebarStatus: SidebarStatus = {
    factory: factory ? factoryStatus(factory, now) : null,
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? 'dev',
    publicProfile: user?.publicProfile && user.githubLogin ? `/u/${user.githubLogin}` : null,
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar status={sidebarStatus} />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Topbar
          user={{
            name: session.user.name,
            email: session.user.email,
            image: session.user.image,
          }}
          lastSyncedAt={user?.lastSyncedAt}
          renderedAt={now.getTime()}
        />
        {syncMessage && <StaleDataBanner message={syncMessage} />}
        {staleMessage && <StaleDataBanner message={staleMessage} />}
        {factoryMessage && <StaleDataBanner message={factoryMessage} />}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 page-content">{children}</main>
      </div>
    </div>
  )
}
