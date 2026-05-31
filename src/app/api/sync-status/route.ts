import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { scans } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const latest = await db.query.scans.findFirst({
    where: eq(scans.userId, session.user.id),
    orderBy: [desc(scans.startedAt)],
    columns: {
      id: true,
      status: true,
      totalRepos: true,
      processedRepos: true,
      startedAt: true,
      completedAt: true,
      error: true,
    },
  })

  return NextResponse.json(latest ?? null)
}
