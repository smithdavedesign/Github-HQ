import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { syncSecurityForUser } from '@/lib/github/security'
import { verifyCronSecret } from '@/lib/cron-auth'
import { isNotNull } from 'drizzle-orm'
import { decrypt } from '@/lib/crypto-utils'

export async function GET(request: Request) {
  if (!verifyCronSecret(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const allUsers = await db.query.users.findMany({
    where: isNotNull(users.githubToken),
    columns: { id: true, githubToken: true },
  })

  let processed = 0
  let failed = 0
  for (const user of allUsers) {
    if (!user.githubToken) continue
    try {
      await syncSecurityForUser(user.id, decrypt(user.githubToken))
      processed++
    } catch (err) {
      failed++
      console.error('[cron/security] user scan failed', {
        userId: user.id,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return NextResponse.json({ ok: true, processed, failed, total: allUsers.length })
}
