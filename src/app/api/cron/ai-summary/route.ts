import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { users, aiSummaryJobs, repositories } from '@/lib/db/schema'
import { generateSummariesForUser, generateRepoSummary } from '@/lib/ai/summary'
import { getLLMAdapter } from '@/lib/ai/adapter'
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
  const enqueueRepos = params.get('enqueueRepos')

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

  // Enqueue one job per repo for all users with tokens
  if (enqueueRepos) {
    const allUsers = await db.query.users.findMany({
      where: isNotNull(users.githubToken),
      columns: { id: true },
    })

    let enqueued = 0
    for (const u of allUsers) {
      const repos = await db.query.repositories.findMany({
        where: eq(repositories.userId, u.id),
        columns: { id: true },
      })
      for (const r of repos) {
        const existing = await db.query.aiSummaryJobs.findFirst({
          where: and(eq(aiSummaryJobs.repoId, r.id), inArray(aiSummaryJobs.status, ['queued', 'processing'])),
          columns: { id: true },
        })
        if (existing) continue
        await db.insert(aiSummaryJobs).values({ userId: u.id, repoId: r.id })
        enqueued++
      }
    }

    return NextResponse.json({ ok: true, enqueued })
  }

  // Process a single queued job (useful for short worker slices)
  if (processOne) {
    const job = await db.query.aiSummaryJobs.findFirst({
      where: eq(aiSummaryJobs.status, 'queued'),
      columns: { id: true, userId: true, repoId: true, attempts: true },
      orderBy: [asc(aiSummaryJobs.createdAt)],
    })

    if (!job) return NextResponse.json({ ok: true, processed: 0 })

    // mark processing
    await db.update(aiSummaryJobs).set({ status: 'processing', updatedAt: new Date() }).where(eq(aiSummaryJobs.id, job.id))

    try {
      if (job.repoId) {
        // process single repo job
        const repo = await db.query.repositories.findFirst({
          where: eq(repositories.id, job.repoId),
          with: { metrics: true, techStack: true },
        })
        if (!repo) throw new Error('Repo not found')

        const adapter = await getLLMAdapter(job.userId)
        await generateRepoSummary(repo.id, {
          name: repo.name,
          description: repo.description,
          language: repo.language,
          frontend: repo.techStack?.frontend ?? null,
          backend: repo.techStack?.backend ?? null,
          database: repo.techStack?.database ?? null,
          hosting: repo.techStack?.hosting ?? null,
          testing: repo.techStack?.testing ?? null,
          openIssues: repo.metrics?.openIssues ?? 0,
          openPrs: repo.metrics?.openPrs ?? 0,
          healthScore: repo.metrics?.healthScore ?? 0,
          activityStatus: repo.metrics?.activityStatus ?? 'unknown',
        }, adapter)
      } else {
        // fallback: per-user summaries
        await generateSummariesForUser(job.userId)
      }

      await db.update(aiSummaryJobs).set({ status: 'done', updatedAt: new Date() }).where(eq(aiSummaryJobs.id, job.id))
      return NextResponse.json({ ok: true, processed: 1, jobId: job.id })
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      console.error('[cron/ai-summary] job failed', { jobId: job.id, userId: job.userId, error: errMsg })
      await db.update(aiSummaryJobs).set({ status: 'failed', attempts: (job.attempts ?? 0) + 1, error: errMsg, updatedAt: new Date() }).where(eq(aiSummaryJobs.id, job.id))
      return NextResponse.json({ error: errMsg }, { status: 500 })
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
