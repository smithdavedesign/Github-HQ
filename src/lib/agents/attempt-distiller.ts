import { db } from '@/lib/db'
import { portfolioEvents, repositories } from '@/lib/db/schema'
import { eq, and, gte } from 'drizzle-orm'
import { distillByAction, type AttemptRecord } from './attempt-distiller-utils'

const LOOKBACK_DAYS = 7

/**
 * Phase 54-T4: distills the last 7 days of `agent_attempt` events into a
 * per-action success rate + common failure reason, written to
 * `repositories.attemptSummary`. Run from the digest cron so `get_coding_brief`
 * can render a compact summary instead of a raw event-by-event list.
 */
export async function distillAttempts(userId: string): Promise<void> {
  const since = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000)

  const attempts = await db.query.portfolioEvents.findMany({
    where: and(
      eq(portfolioEvents.userId, userId),
      eq(portfolioEvents.eventType, 'agent_attempt'),
      gte(portfolioEvents.occurredAt, since),
    ),
    columns: { repoId: true, metadata: true },
  })

  const byRepo = new Map<number, AttemptRecord[]>()
  for (const a of attempts) {
    if (a.repoId == null) continue
    const meta = a.metadata as AttemptRecord | null
    if (!meta?.action) continue
    const list = byRepo.get(a.repoId) ?? []
    list.push(meta)
    byRepo.set(a.repoId, list)
  }

  const allRepos = await db.query.repositories.findMany({
    where: eq(repositories.userId, userId),
    columns: { id: true, attemptSummary: true },
  })

  const generatedAt = new Date().toISOString()

  for (const repo of allRepos) {
    const repoAttempts = byRepo.get(repo.id)

    if (!repoAttempts || repoAttempts.length === 0) {
      // Nothing in the last 7 days — clear any stale summary rather than
      // leaving an out-of-window distillation under a "7d" heading.
      if (repo.attemptSummary != null) {
        await db.update(repositories).set({ attemptSummary: null }).where(eq(repositories.id, repo.id))
      }
      continue
    }

    await db.update(repositories)
      .set({ attemptSummary: { generatedAt, byAction: distillByAction(repoAttempts) } })
      .where(eq(repositories.id, repo.id))
  }
}
