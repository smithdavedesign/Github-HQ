import { and, desc, eq, inArray, like, sql } from 'drizzle-orm'
import type { NeonHttpDatabase } from 'drizzle-orm/neon-http'
import * as schema from '../db/schema'
import type { FactoryActivity } from '../health/freshness'

/**
 * The idle-factory check's input (freshness.ts `factoryStaleMessage`), from the factory's own
 * automation_runs rows (the crons' rows have no user). The dashboard banner and the factory's
 * morning report both read it, each with its own Neon client, so this module has no
 * `server-only` and only relative imports.
 */

/** Runs that do agent work. */
const WORK_KINDS = ['factory-cycle', 'factory-request']

export async function factoryActivity(db: NeonHttpDatabase<typeof schema>, userId: string): Promise<FactoryActivity> {
  const runs = schema.automationRuns
  const factoryRuns = and(eq(runs.userId, userId), like(runs.kind, 'factory-%'))
  const [[agg], [skipped]] = await Promise.all([
    db.select({
      // mapWith: neon-http returns `timestamp` as zone-less text; the column's mapper reads it as UTC.
      lastWorkAt: sql<Date | null>`max(${runs.finishedAt}) filter (where ${inArray(runs.kind, WORK_KINDS)} and ${runs.status} = 'ok')`.mapWith(runs.finishedAt),
      firstRunAt: sql<Date | null>`min(${runs.startedAt})`.mapWith(runs.startedAt),
    }).from(runs).where(factoryRuns),
    db.select({ startedAt: runs.startedAt, summary: runs.summary }).from(runs)
      .where(and(factoryRuns, eq(runs.status, 'skipped')))
      .orderBy(desc(runs.startedAt))
      .limit(1),
  ])
  const lastWorkAt = agg?.lastWorkAt ?? null
  const reason = (skipped?.summary as { reason?: unknown } | null)?.reason
  const skippedSince = skipped && (!lastWorkAt || skipped.startedAt > lastWorkAt)
  return { lastWorkAt, firstRunAt: agg?.firstRunAt ?? null, skipReason: skippedSince && typeof reason === 'string' ? reason : null }
}
