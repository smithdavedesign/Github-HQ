import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { generateSummariesForUser } from '@/lib/ai/summary'
import { verifyCronSecret } from '@/lib/cron-auth'
import { isNotNull } from 'drizzle-orm'

export async function GET(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const allUsers = await db.query.users.findMany({
    where: isNotNull(users.githubToken),
    columns: { id: true },
  })

  let processed = 0
  for (const user of allUsers) {
    try {
      await generateSummariesForUser(user.id)
      processed++
    } catch {
      // Continue
    }
  }

  return NextResponse.json({ ok: true, processed })
}
