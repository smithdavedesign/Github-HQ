import 'server-only'

/**
 * Loads the Ideas page: the idea pipeline's synced records (`ideas`), live demand signals
 * (`idea_signals`), the owner's decisions (`idea_decisions`), "Start build now" requests
 * (`idea_build_requests`) and the pipeline's heartbeat (`idea_pipeline`). Session-less: callers check factoryAccess first (ideas are the owner's).
 */
import { desc, eq, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { ideaBuildRequests, ideaDecisions, ideaPipeline, ideaSeeds, ideaSignals, ideas } from '@/lib/db/schema'
import type { IdeaBuildRequestRow, IdeaDecisionRow, IdeaPolicy, IdeaSeedRow, IdeaView, Signals } from './idea-utils'

export interface IdeasOverview {
  views: IdeaView[]
  pipeline: { tickAt: Date | null; ok: boolean | null; errors: string[]; policy: IdeaPolicy | null }
  /** Ideas submitted on the page: waiting, queued, or researched in the last two weeks. */
  seeds: IdeaSeedRow[]
  /** The tables aren't in this database yet (schema not pushed). */
  missingTables: boolean
  /** idea_build_requests isn't in this database yet: "Start build now" waits for `npm run db:push`. */
  buildRequestsMissing: boolean
}

type IdeaRow = typeof ideas.$inferSelect

function toView(r: IdeaRow, signals: Map<string, Signals>, decisions: IdeaDecisionRow[], buildRequests: IdeaBuildRequestRow[]): IdeaView {
  return {
    slug: r.slug,
    title: r.title,
    stage: r.stage as IdeaView['stage'],
    idea: (r.idea ?? {}) as IdeaView['idea'],
    state: (r.state ?? {}) as IdeaView['state'],
    review: (r.review ?? null) as IdeaView['review'],
    docs: (r.docs ?? {}) as IdeaView['docs'],
    updatedAt: r.updatedAt,
    signals: signals.get(r.slug) ?? null,
    decisions: decisions.filter(d => d.slug === r.slug),
    buildRequests: buildRequests.filter(b => b.slug === r.slug),
  }
}

/** Same counts as the pipeline's signalsBySlug (idea-factory bin/idea-pipeline.js). */
async function liveSignals(): Promise<Map<string, Signals>> {
  const rows = await db.select({
    slug: ideaSignals.slug,
    views: sql<number>`count(*) FILTER (WHERE ${ideaSignals.kind} = 'view')::int`,
    uniqueVisitors: sql<number>`count(DISTINCT ${ideaSignals.ipHash}) FILTER (WHERE ${ideaSignals.kind} = 'view')::int`,
    signups: sql<number>`count(DISTINCT ${ideaSignals.email}) FILTER (WHERE ${ideaSignals.kind} = 'signup')::int`,
  }).from(ideaSignals).groupBy(ideaSignals.slug)
  return new Map(rows.map(r => [r.slug, { views: r.views, uniqueVisitors: r.uniqueVisitors, signups: r.signups }]))
}

const isMissingTable = (e: unknown) => {
  const err = e as { code?: string; cause?: { code?: string }; message?: string }
  return err?.code === '42P01' || err?.cause?.code === '42P01' || /relation "idea(s|_decisions|_pipeline|_seeds|_build_requests)" does not exist/.test(String(err?.message))
}

async function pipelineRow(): Promise<IdeasOverview['pipeline']> {
  const p = await db.query.ideaPipeline.findFirst({ where: eq(ideaPipeline.id, 'main') })
  return { tickAt: p?.tickAt ?? null, ok: p?.ok ?? null, errors: (p?.errors as string[] | null) ?? [], policy: (p?.policy as IdeaPolicy | null) ?? null }
}

const EMPTY: IdeasOverview = { views: [], pipeline: { tickAt: null, ok: null, errors: [], policy: null }, seeds: [], missingTables: true, buildRequestsMissing: true }

const BUILD_REQUESTS_MISSING = Symbol('missing')

/** Submitted ideas still in flight, plus the last two weeks' researched and failed ones; oldest first. */
async function recentSeeds(): Promise<IdeaSeedRow[]> {
  const rows = await db.select().from(ideaSeeds)
    .where(sql`${ideaSeeds.status} IN ('pending', 'queued') OR (${ideaSeeds.status} IN ('researched', 'failed') AND ${ideaSeeds.createdAt} > now() - interval '14 days')`)
    .orderBy(ideaSeeds.createdAt)
  return rows as IdeaSeedRow[]
}

/** Every idea with its live signals and decisions (one query each, joined in memory). */
export async function loadIdeasOverview(): Promise<IdeasOverview> {
  try {
    const [rows, decisions, signals, pipeline, seeds, requests] = await Promise.all([
      db.select().from(ideas),
      db.select().from(ideaDecisions).orderBy(desc(ideaDecisions.createdAt)).limit(500),
      liveSignals(),
      pipelineRow(),
      // The seeds table arrived after the others: a database without it still shows the page.
      recentSeeds().catch(e => { if (isMissingTable(e)) return [] as IdeaSeedRow[]; throw e }),
      // So did the build requests (a newer table still): without it the page works, minus "Start build now".
      db.select().from(ideaBuildRequests).orderBy(desc(ideaBuildRequests.createdAt)).limit(300)
        .catch(e => { if (isMissingTable(e)) return BUILD_REQUESTS_MISSING; throw e }),
    ])
    const ds = decisions as IdeaDecisionRow[]
    const brs = requests === BUILD_REQUESTS_MISSING ? [] : requests as IdeaBuildRequestRow[]
    return { views: rows.map(r => toView(r, signals, ds, brs)), pipeline, seeds, missingTables: false, buildRequestsMissing: requests === BUILD_REQUESTS_MISSING }
  } catch (e) {
    if (isMissingTable(e)) return EMPTY
    throw e
  }
}

/** One idea for the detail page, or null when there's no such slug. */
export async function loadIdea(slug: string): Promise<{ view: IdeaView | null; overview: IdeasOverview }> {
  // The detail page also needs the review queue and the build slot, which span all ideas.
  const overview = await loadIdeasOverview()
  return { view: overview.views.find(v => v.slug === slug) ?? null, overview }
}
