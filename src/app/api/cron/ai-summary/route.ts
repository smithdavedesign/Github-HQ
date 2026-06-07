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

  const url = new URL(request.url)
  const params = url.searchParams
  const list = params.get('list')
  const userId = params.get('user')
  const limitParam = params.get('limit')
  const offsetParam = params.get('offset')
  const limit = limitParam ? parseInt(limitParam, 10) : undefined
  const offset = offsetParam ? parseInt(offsetParam, 10) : undefined

  // Fast path: return list of user ids (so scheduler can drive per-user requests)
  if (list) {
    const allUsers = await db.query.users.findMany({
      where: isNotNull(users.githubToken),
      columns: { id: true },
    })
    return NextResponse.json({ users: allUsers.map((u) => u.id) })
  }

  // Process a single user (short-running slice)
  if (userId) {
    try {
      await generateSummariesForUser(userId)
      return NextResponse.json({ ok: true, user: userId })
    } catch (err) {
      return NextResponse.json({ error: String(err) }, { status: 500 })
    }
  }

  // Batch processing with optional limit/offset (keeps behavior compatible but allows chunking)
  const findOpts: any = {
    where: isNotNull(users.githubToken),
    columns: { id: true },
  }
  if (limit) findOpts.limit = limit
  if (offset) findOpts.offset = offset

  const allUsers = await db.query.users.findMany(findOpts)

  let processed = 0
  for (const user of allUsers) {
    try {
      await generateSummariesForUser(user.id)
      processed++
    } catch {
      // Continue on per-user failure
    }
  }

  return NextResponse.json({ ok: true, processed })
}
