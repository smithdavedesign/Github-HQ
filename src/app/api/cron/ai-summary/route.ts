import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { users, aiSummaryJobs } from '@/lib/db/schema'
import { generateSummariesForUser } from '@/lib/ai/summary'
import { verifyCronSecret } from '@/lib/cron-auth'
import { isNotNull, eq, and, inArray, asc } from 'drizzle-orm'

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
  const enqueue = params.get('enqueue')
  const processOne = params.get('process')

  // Fast path: return list of user ids (so scheduler can drive per-user requests)
  if (list) {
    const allUsers = await db.query.users.findMany({
      where: isNotNull(users.githubToken),
      columns: { id: true },
    })
    return NextResponse.json({ users: allUsers.map((u) => u.id) })
  }

  // Enqueue a job per user (idempotent-ish: skip if already queued/processing)
  if (enqueue) {
    const allUsers = await db.query.users.findMany({
      where: isNotNull(users.githubToken),
      columns: { id: true },
    })

    let enqueued = 0
    for (const u of allUsers) {
      const existing = await db.query.aiSummaryJobs.findFirst({
        where: and(eq(aiSummaryJobs.userId, u.id), inArray(aiSummaryJobs.status, ['queued', 'processing'])),
        columns: { id: true },
      })
      if (existing) continue
      await db.insert(aiSummaryJobs).values({ userId: u.id })
      enqueued++
    }

    return NextResponse.json({ ok: true, enqueued })
  }

  // Process a single queued job (useful for short worker slices)
  if (processOne) {
    const job = await db.query.aiSummaryJobs.findFirst({
      where: eq(aiSummaryJobs.status, 'queued'),
      columns: { id: true, userId: true, repoId: true },
      orderBy: [asc(aiSummaryJobs.createdAt)],
    })

    if (!job) return NextResponse.json({ ok: true, processed: 0 })

    // mark processing
    await db.update(aiSummaryJobs).set({ status: 'processing', updatedAt: new Date() }).where(eq(aiSummaryJobs.id, job.id))

    try {
      // currently we run per-user summaries; per-repo jobs could be handled here if repoId is set
      await generateSummariesForUser(job.userId)
      await db.update(aiSummaryJobs).set({ status: 'done', updatedAt: new Date() }).where(eq(aiSummaryJobs.id, job.id))
      return NextResponse.json({ ok: true, processed: 1, jobId: job.id })
    } catch (err) {
      await db.update(aiSummaryJobs).set({ status: 'failed', attempts: (job as any).attempts + 1, error: String(err), updatedAt: new Date() }).where(eq(aiSummaryJobs.id, job.id))
      return NextResponse.json({ error: String(err) }, { status: 500 })
    }
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
