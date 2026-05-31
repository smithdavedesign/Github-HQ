import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { generateDigest } from '@/lib/ai/digest'
import { generateAdvisor } from '@/lib/ai/advisor'
import { isNotNull } from 'drizzle-orm'

function verifyCronSecret(request: Request): boolean {
  return request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
}

export async function GET(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const allUsers = await db.query.users.findMany({
    where: isNotNull(users.githubToken),
    columns: { id: true },
  })

  let processed = 0
  const errors: string[] = []

  for (const user of allUsers) {
    try {
      // Generate weekly briefing and advisor in parallel
      await Promise.allSettled([
        generateDigest(user.id),
        generateAdvisor(user.id),
      ])
      processed++
    } catch (err) {
      errors.push(err instanceof Error ? err.message : 'Unknown error')
    }
  }

  return NextResponse.json({ ok: true, processed, errors })
}
