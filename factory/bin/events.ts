/**
 * System events (docs/logging.md).
 *   npm run events -- collect [--dry-run]     # what launchd runs every 5 min: ship, probe, alert
 *   npm run events -- emit --system s --component c --event e --status ok|fail [--message "…"]
 *   npm run events -- summary [--hours 24]    # counts per system and what's failing now
 *   npm run events -- tail [--n 30]           # the latest events from Neon
 * Secrets: the database URL and the Slack bot token come from the login keychain
 * (repohq-factory-database-url, system-events-slack-token); the channel from factory.config.json.
 */
import { execFileSync } from 'node:child_process'
import { emitEvent, type EventStatus } from '../system/events'
import { collect } from '../system/collector'
import { loadConfig } from '../lib/config'

const args = process.argv.slice(2)
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }
const keychain = (service: string) => { try { return execFileSync('security', ['find-generic-password', '-s', service, '-w'], { encoding: 'utf8' }).trim() || null } catch { return null } }

async function db() {
  const url = process.env.FACTORY_DATABASE_URL ?? keychain('repohq-factory-database-url')
  if (!url) throw new Error('no database URL (keychain repohq-factory-database-url)')
  const { neon } = await import('@neondatabase/serverless')
  return neon(url)
}

async function main() {
  const [cmd] = args
  if (cmd === 'collect') {
    const cfg = loadConfig()
    const out = await collect({
      databaseUrl: process.env.FACTORY_DATABASE_URL ?? keychain('repohq-factory-database-url'),
      slack: { token: process.env.SYSTEM_EVENTS_SLACK_TOKEN ?? keychain('system-events-slack-token'), channel: cfg.alerts.slackChannel },
      dryRun: args.includes('--dry-run'),
    })
    return console.log(JSON.stringify(out))
  }
  if (cmd === 'emit') {
    emitEvent({ system: flag('--system') ?? 'other', component: flag('--component') ?? 'cli', event: flag('--event') ?? 'note',
      status: (flag('--status') ?? 'info') as EventStatus, message: flag('--message') ?? '' })
    return console.log('ok')
  }
  const sql = await db()
  if (cmd === 'summary') {
    const hours = Number(flag('--hours') ?? 24)
    const counts = await sql`SELECT system, status, count(*)::int AS n FROM system_events WHERE ts > now() - make_interval(hours => ${hours}) GROUP BY system, status ORDER BY system, status`
    const failing = await sql`SELECT DISTINCT ON (fingerprint) fingerprint, status, message, ts FROM system_events WHERE status IN ('ok','fail') ORDER BY fingerprint, ts DESC`
    return console.log(JSON.stringify({ hours, counts, failingNow: (failing as Array<{ status: string }>).filter(f => f.status === 'fail') }, null, 1))
  }
  if (cmd === 'tail') {
    const rows = await sql`SELECT ts, system, component, event, status, message FROM system_events ORDER BY ts DESC LIMIT ${Number(flag('--n') ?? 30)}`
    return console.log((rows as Array<Record<string, string>>).map(r => `${new Date(r.ts!).toISOString().slice(5, 19)} ${r.status === 'fail' ? '✗' : '·'} ${r.system}/${r.component} ${r.event}: ${r.message}`).join('\n'))
  }
  throw new Error('usage: events collect [--dry-run] | emit … | summary [--hours n] | tail [--n n]')
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1 })
