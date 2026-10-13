import 'server-only'

/**
 * Loads the Agents page's idea pipeline panel and usage cards (src/lib/agents/usage-utils.ts):
 * idea-factory's events and the newest Copilot snapshot from system_events, the pipeline's heartbeat
 * (idea_pipeline), its ideas, "Start build now" requests and queued seeds. Session-less: the page
 * checks factoryAccess first (system-wide data, owner only). Tables added later may be missing.
 */
import { and, desc, eq, gt, inArray, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { ideaBuildRequests, ideaPipeline, ideaSeeds, ideas, systemEvents } from '@/lib/db/schema'
import { buildSlot, type IdeaPolicy, type IdeaStateJson } from '@/lib/ideas/idea-utils'
import {
  buildProgress, claudeUsage, copilotUsage, ideaLimits, ideaRuns, runningBuilds,
  type BuildProgress, type ClaudeUsage, type CopilotUsage, type IdeaLimits, type IdeaRun, type LogEvent,
} from './usage-utils'

export interface QueuedBuild { slug: string; milestone: string | null; status: string; result: string | null; createdAt: Date; startedAt: Date | null }

export interface UsageOverview {
  pipeline: { tickAt: Date | null; ok: boolean | null; errors: string[]; policy: IdeaPolicy | null }
  /** Last 7 days, newest first. */
  runs: IdeaRun[]
  /** Building right now: a build's start event without its result, or a running request. */
  building: { idea: string; milestone: string | null; since: Date; manual: boolean; model: string | null; effort: string | null; limitMinutes: number | null; planned: string[] | null; progress: BuildProgress | null }[]
  queue: { builds: QueuedBuild[]; awaitingReview: number; seedsQueued: number; prsToReview: number }
  limits: IdeaLimits
  claude: ClaudeUsage
  copilot: CopilotUsage | null
}

const missing = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string }; message?: string }
  return err?.code === '42P01' || err?.cause?.code === '42P01' || /relation "[a-z_]+" does not exist/.test(String(err?.message))
}
const orEmpty = <T>(p: Promise<T[]>): Promise<T[]> => p.catch(e => { if (missing(e)) return [] as T[]; throw e })

const eventCols = {
  ts: systemEvents.ts, system: systemEvents.system, component: systemEvents.component, event: systemEvents.event,
  status: systemEvents.status, message: systemEvents.message, durationMs: systemEvents.durationMs, subject: systemEvents.subject, data: systemEvents.data,
}

export async function loadUsageOverview(now = new Date()): Promise<UsageOverview> {
  const [events, copilotRows, beat, ideaRows, requests, seeds] = await Promise.all([
    db.select(eventCols).from(systemEvents)
      .where(and(eq(systemEvents.system, 'idea-factory'), inArray(systemEvents.component, ['research', 'review', 'build', 'revenue', 'claude']), gt(systemEvents.ts, sql`now() - interval '7 days'`)))
      .orderBy(desc(systemEvents.ts)).limit(400),
    db.select(eventCols).from(systemEvents)
      .where(and(eq(systemEvents.system, 'factory'), eq(systemEvents.component, 'copilot'), eq(systemEvents.event, 'usage')))
      .orderBy(desc(systemEvents.ts)).limit(1),
    orEmpty(db.select().from(ideaPipeline).where(eq(ideaPipeline.id, 'main')).limit(1)),
    orEmpty(db.select({ slug: ideas.slug, stage: ideas.stage, state: ideas.state }).from(ideas)),
    orEmpty(db.select().from(ideaBuildRequests)
      .where(or(inArray(ideaBuildRequests.status, ['pending', 'running']), gt(ideaBuildRequests.startedAt, sql`now() - interval '24 hours'`)))
      .orderBy(ideaBuildRequests.createdAt)),
    orEmpty(db.select({ id: ideaSeeds.id }).from(ideaSeeds).where(inArray(ideaSeeds.status, ['pending', 'queued']))),
  ])
  const logEvents = events as LogEvent[]
  const p = beat[0]
  const policy = (p?.policy as IdeaPolicy | null) ?? null
  const runs = ideaRuns(logEvents)

  const building = new Map<string, UsageOverview['building'][number]>()
  for (const r of runningBuilds(runs, now, policy?.build?.timeoutMinutes ?? 45)) {
    building.set(r.idea!, { idea: r.idea!, milestone: r.milestone, since: r.at, manual: r.manual, model: r.model, effort: r.effort,
      limitMinutes: r.timeoutMinutes ?? policy?.build?.timeoutMinutes ?? 45, planned: r.planned, progress: buildProgress(logEvents, r.idea!, r.at) })
  }
  for (const q of requests) {
    if (q.status === 'running' && !building.has(q.slug)) {
      const since = q.startedAt ?? q.createdAt
      building.set(q.slug, { idea: q.slug, milestone: q.milestone, since, manual: true, model: null, effort: null, limitMinutes: null, planned: null, progress: buildProgress(logEvents, q.slug, since) })
    }
  }

  const states = ideaRows.map(r => ({ slug: r.slug, stage: r.stage, state: (r.state ?? {}) as IdeaStateJson }))
  return {
    pipeline: { tickAt: p?.tickAt ?? null, ok: p?.ok ?? null, errors: (p?.errors as string[] | null) ?? [], policy },
    runs,
    building: [...building.values()],
    queue: {
      builds: requests.filter(q => q.status === 'pending').map(q => ({ slug: q.slug, milestone: q.milestone, status: q.status, result: q.result, createdAt: q.createdAt, startedAt: q.startedAt })),
      awaitingReview: states.filter(s => s.stage === 'idea').length,
      seedsQueued: seeds.length,
      prsToReview: states.filter(s => s.state.build?.status === 'pr-open').length,
    },
    limits: ideaLimits({
      // What's building per the build events and running requests (the record's "running" can lag).
      running: building.size,
      slot: buildSlot(states, policy),
      runs, policy, now,
    }),
    claude: claudeUsage(logEvents, now),
    copilot: copilotUsage((copilotRows[0] as LogEvent | undefined) ?? null, now),
  }
}
