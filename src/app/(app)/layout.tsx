import { auth } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { Sidebar } from '@/components/layout/sidebar'
import { Topbar } from '@/components/layout/topbar'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { lastSyncedAt: true },
  })

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
        <main className="flex-1 overflow-y-auto p-6 page-content">{children}</main>
      </div>
    </div>
  )
}
