import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { Sidebar } from '@/components/layout/sidebar'
import { Topbar } from '@/components/layout/topbar'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { latestSnapshotDate } from '@/lib/health/history'
import { snapshotFreshness, staleDataMessage } from '@/lib/health/freshness'
import { StaleDataBanner } from '@/components/layout/stale-data-banner'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const [user, latestSnapshot] = await Promise.all([
    db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: { lastSyncedAt: true },
    }),
    latestSnapshotDate(session.user.id).catch(() => null),
  ])
  // Request time is the point: the banner says how old the data is right now.
  const staleMessage = staleDataMessage(snapshotFreshness(latestSnapshot, new Date()))

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Topbar
          user={{
            name: session.user.name,
            email: session.user.email,
            image: session.user.image,
          }}
          lastSyncedAt={user?.lastSyncedAt}
        />
        {staleMessage && <StaleDataBanner message={staleMessage} />}
        <main className="flex-1 overflow-y-auto p-4 sm:p-6 page-content">{children}</main>
      </div>
    </div>
  )
}
