/**
 * What's failing now and recent activity, from `system_events` (docs/logging.md). One query set for
 * every reader: the morning report, the OpenClaw brief, `npm run events -- summary` and the MCP tool
 * `get_system_status`.
 */
import type { NeonQueryFunction } from '@neondatabase/serverless'

type Sql = NeonQueryFunction<false, false>

export interface FailingEvent { fingerprint: string; status: string; message: string; ts: string }
export interface SystemCount { system: string; status: string; n: number }
export interface RecentEvent { ts: string; system: string; component: string; event: string; status: string; message: string }

export interface SystemStatus {
  hours: number
  counts: SystemCount[]
  failingNow: FailingEvent[]
  recent?: RecentEvent[]
}

/**
 * The latest ok/fail per fingerprint within 7 days, keeping the failures. A fingerprint that hasn't
 * reported for 7 days drops out instead of looking failed forever.
 */
export async function failingNow(sql: Sql): Promise<FailingEvent[]> {
  const latest = await sql`SELECT DISTINCT ON (fingerprint) fingerprint, status, message, ts FROM system_events WHERE status IN ('ok','fail') AND ts > now() - interval '7 days' ORDER BY fingerprint, ts DESC`
  return (latest as FailingEvent[]).filter(r => r.status === 'fail')
}

export async function systemStatus(sql: Sql, opts: { hours?: number; recent?: number } = {}): Promise<SystemStatus> {
  const hours = opts.hours ?? 24
  const [counts, failing, recent] = await Promise.all([
    sql`SELECT system, status, count(*)::int AS n FROM system_events WHERE ts > now() - make_interval(hours => ${hours}) GROUP BY system, status ORDER BY system, status`,
    failingNow(sql),
    opts.recent ? sql`SELECT ts, system, component, event, status, message FROM system_events ORDER BY ts DESC LIMIT ${opts.recent}` : Promise.resolve(null),
  ])
  return { hours, counts: counts as SystemCount[], failingNow: failing, ...(recent ? { recent: recent as RecentEvent[] } : {}) }
}

const stamp = (ts: string) => new Date(ts).toISOString().slice(5, 16).replace('T', ' ')

/** Plain-text status for agents: failures first, then counts per system, then the latest events. Pure. */
export function formatSystemStatus(s: SystemStatus): string {
  const lines: string[] = []
  lines.push(s.failingNow.length
    ? `## Failing now (${s.failingNow.length})\n${s.failingNow.map(f => `- ${f.fingerprint} (last ${stamp(f.ts)} UTC): ${f.message.slice(0, 240)}`).join('\n')}`
    : '## Failing now\nNothing.')
  const bySystem = new Map<string, Record<string, number>>()
  for (const c of s.counts) bySystem.set(c.system, { ...bySystem.get(c.system), [c.status]: c.n })
  lines.push(`## Last ${s.hours}h by system\n${bySystem.size
    ? [...bySystem].map(([sys, st]) => `- ${sys}: ${Object.entries(st).map(([k, n]) => `${n} ${k}`).join(', ')}`).join('\n')
    : 'No events.'}`)
  if (s.recent?.length) {
    lines.push(`## Latest ${s.recent.length} events\n` + s.recent.map(r => `${stamp(r.ts)} ${r.status === 'fail' ? '✗' : '·'} ${r.system}/${r.component} ${r.event}: ${r.message.slice(0, 200)}`).join('\n'))
  }
  lines.push('Fix guidance: RepoHQ docs/logging.md (probes and what each alert means).')
  return lines.join('\n\n')
}
