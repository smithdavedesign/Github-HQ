'use server'

import { revalidatePath } from 'next/cache'
import { and, desc, eq } from 'drizzle-orm'
import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { ideaBuildRequests, ideaDecisions, ideaSeeds, ideas } from '@/lib/db/schema'
import { factoryAccess } from '@/lib/agents/factory-queue'
import { buildMvpTarget, buildNowTarget, checkDecision, cleanIdeaText, type IdeaBuildRequestRow, type IdeaDecisionKind, type IdeaView } from '@/lib/ideas/idea-utils'

// Browser-facing actions for the Ideas page. The owner's decision becomes an `idea_decisions` row;
// the idea pipeline on the Mac applies it on its next tick by setting the Notion Status
// (docs/idea-factory.md). Types only below — a 'use server' file exports nothing but async functions.

export interface QueuedDecision { id: number; status: 'pending' }

const KINDS: readonly IdeaDecisionKind[] = ['build', 'validate', 'pass']
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/
const MAX_NOTE = 1000

async function ownerId(): Promise<string> {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  const access = factoryAccess(session.user.id)
  if (!access.ok) throw new Error(access.reason)
  return session.user.id
}

/** Wraps Drizzle calls: raw database errors become a clean message; our own errors pass through. */
async function dbOp<T>(label: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof DecisionError) throw new Error(err.message)
    console.error(`[ideas/${label}]`, err instanceof Error ? err.message : err)
    throw new Error(`Failed to ${label}. Please try again.`)
  }
}

class DecisionError extends Error {}

function revalidate(slug: string) {
  revalidatePath('/ideas')
  revalidatePath(`/ideas/${slug}`)
}

/** Approve a build, send to a demand test, or pass. Replaces any decision still pending for the idea. */
export async function decideIdea(slug: string, decision: IdeaDecisionKind, note?: string): Promise<QueuedDecision> {
  const userId = await ownerId()
  if (!SLUG_RE.test(slug)) throw new Error('Unknown idea')
  if (!KINDS.includes(decision)) throw new Error('Unknown decision')
  const text = (note ?? '').trim().slice(0, MAX_NOTE) || null

  const row = await dbOp('record the decision', async () => {
    const idea = await db.query.ideas.findFirst({ where: eq(ideas.slug, slug) })
    if (!idea) throw new DecisionError('Unknown idea')
    const check = checkDecision({
      stage: idea.stage as IdeaView['stage'], state: idea.state as IdeaView['state'],
      review: idea.review as IdeaView['review'], notionUrl: idea.notionUrl,
    }, decision)
    if (!check.ok) throw new DecisionError(check.reason)
    await db.update(ideaDecisions)
      .set({ status: 'cancelled', result: 'replaced by a newer decision' })
      .where(and(eq(ideaDecisions.slug, slug), eq(ideaDecisions.status, 'pending')))
    const [inserted] = await db.insert(ideaDecisions).values({ slug, userId, decision, note: text }).returning({ id: ideaDecisions.id })
    return inserted
  })
  revalidate(slug)
  return { id: row.id, status: 'pending' }
}

/** Take back a decision the pipeline hasn't applied yet. */
export async function cancelIdeaDecision(id: number): Promise<void> {
  await ownerId()
  if (!Number.isInteger(id) || id <= 0) throw new Error('Unknown decision')
  const slug = await dbOp('cancel the decision', async () => {
    const [row] = await db.update(ideaDecisions)
      .set({ status: 'cancelled', result: 'cancelled by the owner' })
      .where(and(eq(ideaDecisions.id, id), eq(ideaDecisions.status, 'pending')))
      .returning({ slug: ideaDecisions.slug })
    if (!row) throw new DecisionError('Already applied by the pipeline, or already cancelled.')
    return row.slug
  })
  revalidate(slug)
}

/**
 * A new idea for the research queue, like "idea: …" on Slack or WhatsApp. The pipeline moves it into
 * idea-factory's queue on its next tick, which also researches and reviews the oldest queued idea (policy.research.seeded).
 */
export async function submitIdea(text: string): Promise<{ id: number }> {
  const userId = await ownerId()
  const clean = cleanIdeaText(text)
  if (!clean.ok) throw new Error(clean.reason)
  const row = await dbOp('queue the idea', async () => {
    const [inserted] = await db.insert(ideaSeeds).values({ userId, text: clean.text }).returning({ id: ideaSeeds.id })
    return inserted
  })
  revalidatePath('/ideas')
  return { id: row.id }
}

/** Withdraw a submitted idea the pipeline hasn't picked up yet. */
export async function cancelIdeaSeed(id: number): Promise<void> {
  await ownerId()
  if (!Number.isInteger(id) || id <= 0) throw new Error('Unknown idea')
  await dbOp('withdraw the idea', async () => {
    const [row] = await db.update(ideaSeeds)
      .set({ status: 'cancelled', result: 'withdrawn by the owner' })
      .where(and(eq(ideaSeeds.id, id), eq(ideaSeeds.status, 'pending')))
      .returning({ id: ideaSeeds.id })
    if (!row) throw new DecisionError('Already in the research queue, so it can’t be withdrawn here.')
  })
  revalidatePath('/ideas')
}

/**
 * "Start build now" (one milestone) or "Build the MVP" (`mode: 'mvp'`, every remaining milestone in one
 * run): the pipeline builds it on its next tick, outside the weekly
 * build slot (idea_build_requests; at most policy.build.manualPerDay starts in 24 hours, the rest wait).
 */
export async function requestBuild(slug: string, note?: string, mode: 'milestone' | 'mvp' = 'milestone'): Promise<{ id: number; milestone: string }> {
  const userId = await ownerId()
  if (!SLUG_RE.test(slug)) throw new Error('Unknown idea')
  const text = (note ?? '').trim().slice(0, MAX_NOTE) || null
  const row = await dbOp('queue the build', async () => {
    const idea = await db.query.ideas.findFirst({ where: eq(ideas.slug, slug) })
    if (!idea) throw new DecisionError('Unknown idea')
    const requests = await db.select().from(ideaBuildRequests).where(eq(ideaBuildRequests.slug, slug)).orderBy(desc(ideaBuildRequests.createdAt)).limit(20)
    const view = {
      stage: idea.stage as IdeaView['stage'], state: idea.state as IdeaView['state'], docs: idea.docs as IdeaView['docs'],
      buildRequests: requests as IdeaBuildRequestRow[],
    }
    // "MVP" on the request: idea-factory builds every remaining milestone in one run.
    const target = mode === 'mvp' ? buildMvpTarget(view) : buildNowTarget(view)
    if (!target.ok) throw new DecisionError(target.reason)
    const milestone = mode === 'mvp' ? 'MVP' : (target as { milestone: string }).milestone
    const [inserted] = await db.insert(ideaBuildRequests).values({ slug, userId, milestone, note: text })
      .returning({ id: ideaBuildRequests.id, milestone: ideaBuildRequests.milestone })
    return inserted
  })
  revalidate(slug)
  return { id: row.id, milestone: row.milestone ?? 'M1' }
}

/** Withdraw a build request the pipeline hasn't started. */
export async function cancelBuildRequest(id: number): Promise<void> {
  await ownerId()
  if (!Number.isInteger(id) || id <= 0) throw new Error('Unknown build request')
  const slug = await dbOp('withdraw the build', async () => {
    const [row] = await db.update(ideaBuildRequests)
      .set({ status: 'cancelled', result: 'withdrawn by the owner', finishedAt: new Date() })
      .where(and(eq(ideaBuildRequests.id, id), eq(ideaBuildRequests.status, 'pending')))
      .returning({ slug: ideaBuildRequests.slug })
    if (!row) throw new DecisionError('Already started by the pipeline, or already withdrawn.')
    return row.slug
  })
  revalidate(slug)
}
