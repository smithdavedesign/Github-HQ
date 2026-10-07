/**
 * The morning report's Agent HQ lines (roadmap Phase 81, factory/lib/system-health.ts) against a
 * real database, in a non-UTC time zone. Timestamps are stored as zone-less UTC: a Date sent as a
 * raw parameter goes out in local time, and a raw timestamp read back parses as local time — both
 * shift the numbers by the UTC offset (7–8 hours here). requestOutcomes and factoryActivity
 * must do neither.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import { loadConfig } from '../../factory/lib/config'
import { factoryActivityOf, requestOutcomes } from '../../factory/lib/sink'
import { factoryActivity } from '../../src/lib/agents/factory-activity'
import * as schema from '../../src/lib/db/schema'
import { requestsFailing, systemHealthLines } from '../../factory/lib/system-health'
import { FLOW, closePools, createDatabase, neonUrl, q, seed } from './harness/flow'

const DB = 'agent_hq_flow_report'
const HOUR = 3_600_000
const DAY = 24 * HOUR
const now = new Date()

beforeAll(async () => {
  await createDatabase(DB)
  const s = await seed(DB)
  const row = (id: string, status: string, createdAgo: number, resolvedAgo: number | null) =>
    q(DB, `INSERT INTO agent_requests (id, user_id, repo_id, repo, mode, objective, source, status, created_at, resolved_at)
      VALUES ($1, $2, $3, $4, 'fix', 'x', 'ui-skill', $5, $6, $7)`, [
      id, FLOW.ownerId, s.repoId, FLOW.allowlistedRepo, status,
      new Date(now.getTime() - createdAgo).toISOString(), resolvedAgo === null ? null : new Date(now.getTime() - resolvedAgo).toISOString(),
    ])
  await row('pr-1', 'pr', 2 * DAY, 2 * DAY - HOUR)
  await row('pr-2', 'pr', 3 * DAY, 3 * DAY - HOUR)
  await row('reported-1', 'reported', DAY, DAY - HOUR)
  await row('failed-1', 'failed', 4 * DAY, 4 * DAY - HOUR)
  await row('cancelled-1', 'cancelled', 5 * DAY, 5 * DAY - HOUR)
  // Either side of the 7-day edge by 3 hours: less than the UTC offset, so a local-time
  // parameter would count the second one.
  await row('edge-in', 'verified', 8 * DAY, 7 * DAY - 3 * HOUR)
  await row('edge-out', 'failed', 8 * DAY, 7 * DAY + 3 * HOUR)
  await row('old-failures', 'failed', 20 * DAY, 10 * DAY)
  // Still waiting: one for 50 hours, one picked up an hour ago.
  await row('waiting-1', 'queued', 50 * HOUR, null)
  await row('waiting-2', 'running', HOUR, null)
  // Someone else's requests never count.
  await q(DB, `INSERT INTO agent_requests (id, user_id, repo, mode, objective, source, status, created_at) VALUES ('other-1', $1, 'o/r', 'fix', 'x', 'mcp', 'queued', $2)`,
    [FLOW.otherUserId, new Date(now.getTime() - 90 * HOUR).toISOString()])

  // Factory runs: the last cycle that did work was 40 hours ago. Since then Docker has been down
  // (cycles skipped), a request run failed, and the daily report kept finishing ok.
  const run = (id: string, userId: string | null, kind: string, status: string, startedAgo: number, reason?: string) =>
    q(DB, `INSERT INTO automation_runs (id, user_id, kind, trigger, status, summary, started_at, finished_at) VALUES ($1, $2, $3, 'schedule', $4, $5, $6, $7)`, [
      id, userId, kind, status, reason ? JSON.stringify({ reason }) : null,
      new Date(now.getTime() - startedAgo).toISOString(), new Date(now.getTime() - startedAgo + 60_000).toISOString(),
    ])
  await run('first', FLOW.ownerId, 'factory-scout', 'ok', 30 * DAY)
  await run('work', FLOW.ownerId, 'factory-cycle', 'ok', 40 * HOUR)
  await run('skip-old', FLOW.ownerId, 'factory-cycle', 'skipped', 30 * HOUR, 'on battery power (plug in for the night shift)')
  await run('request-failed', FLOW.ownerId, 'factory-request', 'failed', 20 * HOUR)
  await run('skip-new', FLOW.ownerId, 'factory-cycle', 'skipped', HOUR, 'Docker is not running (repo code never runs on the host)')
  await run('report', FLOW.ownerId, 'factory-report', 'ok', 2 * HOUR)
  await run('cron', null, 'cron:sync', 'ok', HOUR)
  // The other user's worker did work after its last skip: no reason to show.
  await run('other-skip', FLOW.otherUserId, 'factory-cycle', 'skipped', 10 * HOUR, 'Docker is not running (repo code never runs on the host)')
  await run('other-work', FLOW.otherUserId, 'factory-request', 'ok', 5 * HOUR)
})

afterAll(closePools)

describe('requestOutcomes (the morning report\'s Agent HQ line)', () => {
  const cfg = () => loadConfig({ ...process.env, FACTORY_USER_ID: FLOW.ownerId, FACTORY_DATABASE_URL: neonUrl(DB) } as NodeJS.ProcessEnv)

  it('runs in a non-UTC zone (the point of this file)', () => {
    expect(new Date().getTimezoneOffset()).not.toBe(0)
  })

  it('counts the last 7 days by status, with a UTC window edge, and the oldest waiting request in hours', async () => {
    expect(await requestOutcomes(cfg(), new Date(now.getTime() - 7 * DAY), now)).toEqual({
      resolved: { pr: 2, reported: 1, failed: 1, cancelled: 1, verified: 1 },
      waiting: 2,
      oldestWaitingHours: 50,
    })
  })

  it('a request stuck for 48 hours raises the alarm in the report', async () => {
    const r = (await requestOutcomes(cfg(), new Date(now.getTime() - 7 * DAY), now))!
    expect(requestsFailing(r)).toBe(true)
    expect(systemHealthLines({ disabledWorkflows: [], latestSnapshot: null, requests: r }, now)).toEqual({
      lines: ['Scheduled workflows: all enabled.', '⚠ Agent requests, last 7 days: 2 PR, 1 verified, 1 reported, 1 failed, 1 cancelled · 2 waiting (oldest 50h).'],
      alarm: true,
    })
  })

  it('without the sink configured there is no line at all', async () => {
    const noSink = loadConfig({ ...process.env, FACTORY_USER_ID: '' } as NodeJS.ProcessEnv)
    expect(await requestOutcomes(noSink, new Date(now.getTime() - 7 * DAY), now)).toBeNull()
    expect(await factoryActivityOf(noSink)).toBeNull()
  })
})

describe('factoryActivity (the idle-factory banner and report line)', () => {
  const cfg = () => loadConfig({ ...process.env, FACTORY_USER_ID: FLOW.ownerId, FACTORY_DATABASE_URL: neonUrl(DB) } as NodeJS.ProcessEnv)

  it('only finished cycles and requests count as work; skipped runs and the daily report do not', async () => {
    expect(await factoryActivityOf(cfg())).toEqual({
      lastWorkAt: new Date(now.getTime() - 40 * HOUR + 60_000),
      firstRunAt: new Date(now.getTime() - 30 * DAY),
      skipReason: 'Docker is not running (repo code never runs on the host)',
    })
  })

  it('so the report raises the alarm while Docker is down', async () => {
    const health = systemHealthLines({ disabledWorkflows: [], latestSnapshot: null, requests: null, factory: await factoryActivityOf(cfg()) }, now)
    expect(health.alarm).toBe(true)
    expect(health.lines[1]).toMatch(/^⚠ Factory: The factory hasn't finished a cycle or request in 39 hours.*skipped: Docker is not running/)
  })

  it('a skip older than the last work is not the reason', async () => {
    const db = drizzle(neon(neonUrl(DB)), { schema })
    expect(await factoryActivity(db, FLOW.otherUserId)).toEqual({
      lastWorkAt: new Date(now.getTime() - 5 * HOUR + 60_000),
      firstRunAt: new Date(now.getTime() - 10 * HOUR),
      skipReason: null,
    })
  })
})
