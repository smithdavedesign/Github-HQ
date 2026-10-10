/**
 * The system-events collector (docs/logging.md). launchd runs it every 5 minutes:
 *   1. read new lines from ~/.system-events/events.jsonl (any system writes there);
 *   2. add probes nobody else runs: local services (LiteLLM, Ollama, Headroom, OpenClaw, Docker), launchd
 *      jobs, OpenClaw cron runs, GitHub Actions cron state, failed RepoHQ automation runs, and provider
 *      errors in LiteLLM's log (out of credit, auth, rate limits);
 *   3. ship to Neon `system_events` (redacted);
 *   4. post failures and recoveries to Slack (deduplicated: one alert per failure, repeated every 6h).
 * Pure parts are exported for tests; IO is at the bottom.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { EVENTS_DIR, EVENTS_FILE, fingerprint, normalizeEvent, type SystemEvent } from './events'
import { refreshOpenClawBrief } from '../context/brief'

// ─── What's watched ─────────────────────────────────────────────────────────

/** launchd jobs: daemons must be running; interval jobs must have exited 0 last time. */
export const WATCHED_JOBS: Array<{ label: string; kind: 'daemon' | 'interval'; system: string; component: string }> = [
  { label: 'com.repohq.factory.worker', kind: 'daemon', system: 'factory', component: 'worker' },
  { label: 'ai.openclaw.gateway', kind: 'daemon', system: 'openclaw', component: 'gateway' },
  { label: 'com.localai.headroom', kind: 'daemon', system: 'ai-stack', component: 'headroom' },
  { label: 'com.ollama.ollama', kind: 'daemon', system: 'ai-stack', component: 'ollama' },
  { label: 'com.user.caffeinate-ac', kind: 'daemon', system: 'ai-stack', component: 'caffeinate' },
  { label: 'com.user.idea-pipeline', kind: 'interval', system: 'idea-factory', component: 'pipeline' },
  { label: 'com.user.repohq-frontdoor-report', kind: 'interval', system: 'openclaw', component: 'frontdoor' },
  { label: 'com.user.system-events', kind: 'interval', system: 'ai-stack', component: 'collector' },
  { label: 'com.user.factory-backup', kind: 'interval', system: 'factory', component: 'backup' },
  // homebrew.mxcl.ollama is deliberately not watched: it exits 1 by design (Ollama.app owns :11434).
]

const VERCEL_SCOPE = process.env.VERCEL_SCOPE ?? 'team_ONe0JJaVwgXIAUMHZ7OUgkku'

export const HTTP_PROBES: Array<{ system: string; component: string; url: string; auth?: 'litellm' }> = [
  { system: 'ai-stack', component: 'litellm', url: 'http://127.0.0.1:4000/health/liveliness' },
  { system: 'ai-stack', component: 'ollama', url: 'http://127.0.0.1:11434/api/version' },
  { system: 'ai-stack', component: 'headroom', url: 'http://127.0.0.1:8787/health' },
  { system: 'openclaw', component: 'gateway', url: 'http://127.0.0.1:18789/' },
  { system: 'repohq', component: 'app', url: 'https://repohq.vercel.app/login' },
]

/** Provider trouble that otherwise only shows up as a fallback (2026-10-10: Anthropic credit ran out silently). */
export const PROVIDER_ERRORS: Array<{ re: RegExp; event: string; message: string }> = [
  { re: /credit balance is too low/i, event: 'anthropic-credit', message: 'Anthropic API credit is exhausted: cloud-smart calls fail and fall back' },
  { re: /AuthenticationError|invalid x-api-key|Incorrect API key/i, event: 'provider-auth', message: 'a provider rejected its API key' },
  { re: /RateLimitError|rate limit/i, event: 'provider-rate-limit', message: 'a provider is rate limiting LiteLLM' },
]

// ─── Pure: probes → events ──────────────────────────────────────────────────

const ev = (system: string, component: string, event: string, ok: boolean, message: string, data?: Record<string, unknown>, now = new Date()): SystemEvent => ({
  ts: now.toISOString(), system, component, event, status: ok ? 'ok' : 'fail', level: ok ? 'info' : 'error', message, ...(data ? { data } : {}),
})

/** `launchctl list` output → one event per watched job. */
export function launchdEvents(listOutput: string, now = new Date()): SystemEvent[] {
  const rows = new Map<string, { pid: string; status: string }>()
  for (const line of listOutput.split('\n').slice(1)) {
    const [pid, status, label] = line.trim().split(/\s+/)
    if (label) rows.set(label, { pid: pid!, status: status! })
  }
  return WATCHED_JOBS.map(j => {
    const r = rows.get(j.label)
    if (!r) return ev(j.system, j.component, 'launchd', false, `launchd job ${j.label} is not loaded`, { label: j.label }, now)
    if (j.kind === 'daemon') {
      const running = r.pid !== '-'
      return ev(j.system, j.component, 'launchd', running, running ? `${j.label} running (pid ${r.pid})` : `${j.label} is not running (last exit ${r.status})`, { label: j.label }, now)
    }
    const ok = r.status === '0'
    return ev(j.system, j.component, 'launchd', ok, ok ? `${j.label} last run exited 0` : `${j.label} last run exited ${r.status}`, { label: j.label }, now)
  })
}

/** OpenClaw cron run lines (one JSON object each) since `sinceMs` → events, named by job. */
export function openClawCronEvents(lines: string[], jobNames: Map<string, string>, sinceMs: number): SystemEvent[] {
  const out: SystemEvent[] = []
  for (const line of lines) {
    let r: { ts?: number; jobId?: string; action?: string; status?: string; error?: string; summary?: string; durationMs?: number }
    try { r = JSON.parse(line) } catch { continue }
    if (r.action !== 'finished' || !r.ts || r.ts <= sinceMs) continue
    const name = jobNames.get(r.jobId ?? '') ?? r.jobId ?? 'unknown'
    const ok = r.status === 'ok'
    out.push({
      ts: new Date(r.ts).toISOString(), system: 'openclaw', component: `cron:${name}`, event: 'run',
      status: ok ? 'ok' : 'fail', level: ok ? 'info' : 'error',
      message: ok ? `${name} finished` : `${name} failed: ${String(r.error ?? r.summary ?? r.status).slice(0, 300)}`,
      ...(typeof r.durationMs === 'number' ? { durationMs: r.durationMs } : {}),
    })
  }
  return out
}

/** `gh workflow list --json name,state` → a failure for every disabled scheduled workflow (the 60-day trap). */
export function workflowEvents(repo: string, workflows: Array<{ name: string; state: string }>, now = new Date()): SystemEvent[] {
  return workflows.filter(w => /^cron/i.test(w.name)).map(w => ev('github', `workflow:${w.name}`, 'state', w.state === 'active',
    w.state === 'active' ? `${repo} "${w.name}" is active` : `${repo} "${w.name}" is ${w.state} — re-enable with gh workflow enable`, { repo }, now))
}

/** Vercel production deployments (newest first) → one event per project: its latest finished deploy. */
export function vercelEvents(deployments: Array<{ name: string; state?: string; readyState?: string; url?: string; inspectorUrl?: string }>, now = new Date()): SystemEvent[] {
  const latest = new Map<string, (typeof deployments)[number]>()
  for (const d of deployments) {
    const state = d.state ?? d.readyState ?? ''
    if (!['READY', 'ERROR', 'CANCELED'].includes(state) || latest.has(d.name)) continue // still building: wait
    latest.set(d.name, d)
  }
  return [...latest.values()].map(d => {
    const state = d.state ?? d.readyState
    return ev('vercel', d.name, 'deploy', state === 'READY', state === 'READY' ? `${d.name} production is live` : `${d.name}'s latest production deploy is ${state}: ${d.inspectorUrl ?? d.url ?? ''}`, undefined, now)
  })
}

/** LiteLLM log text → one event per kind of provider trouble seen (ok when none). */
export function providerEvents(logText: string, now = new Date()): SystemEvent[] {
  return PROVIDER_ERRORS.map(p => {
    const hits = (logText.match(new RegExp(p.re.source, 'gi')) ?? []).length
    return ev('ai-stack', 'litellm-providers', p.event, hits === 0, hits ? `${p.message} (${hits} in the last window)` : `no ${p.event} errors`, hits ? { hits } : undefined, now)
  })
}

/**
 * Probes ship only when their status changes, plus an hourly heartbeat, so the table holds
 * transitions rather than 288 identical "ok" rows a day per probe.
 */
export function probesToShip(events: SystemEvent[], last: Record<string, { status: string; at: string }>, now: Date): { ship: SystemEvent[]; last: Record<string, { status: string; at: string }> } {
  const next = { ...last }
  const ship: SystemEvent[] = []
  for (const e of events) {
    const fp = fingerprint(e)
    const prev = next[fp]
    if (!prev || prev.status !== e.status || now.getTime() - new Date(prev.at).getTime() >= 3_600_000) {
      ship.push(e)
      next[fp] = { status: e.status, at: now.toISOString() }
    }
  }
  return { ship, last: next }
}

// ─── Pure: alerts ───────────────────────────────────────────────────────────

export interface AlertState { open: Record<string, { since: string; lastAlert: string; message: string }> }
export interface Alert { kind: 'fail' | 'recovered' | 'still-failing'; fp: string; message: string; since: string }

export const REALERT_MS = 6 * 3_600_000

/** One alert when something starts failing, a reminder every 6h while it stays down, one when it recovers. */
export function decideAlerts(events: SystemEvent[], state: AlertState, now: Date): { alerts: Alert[]; state: AlertState } {
  const open = { ...state.open }
  const alerts: Alert[] = []
  const latest = new Map<string, SystemEvent>()
  for (const e of [...events].sort((a, b) => a.ts.localeCompare(b.ts))) if (e.status === 'ok' || e.status === 'fail') latest.set(fingerprint(e), e)
  for (const [fp, e] of latest) {
    const o = open[fp]
    if (e.status === 'fail') {
      if (!o) {
        open[fp] = { since: e.ts, lastAlert: now.toISOString(), message: e.message }
        alerts.push({ kind: 'fail', fp, message: e.message, since: e.ts })
      } else if (now.getTime() - new Date(o.lastAlert).getTime() >= REALERT_MS) {
        open[fp] = { ...o, lastAlert: now.toISOString(), message: e.message }
        alerts.push({ kind: 'still-failing', fp, message: e.message, since: o.since })
      }
    } else if (o) {
      delete open[fp]
      alerts.push({ kind: 'recovered', fp, message: e.message, since: o.since })
    }
  }
  return { alerts, state: { open } }
}

export function slackText(alerts: Alert[], now: Date): string {
  const icon = { fail: '🔴', 'still-failing': '🟠', recovered: '🟢' } as const
  const ago = (iso: string) => { const m = Math.round((now.getTime() - new Date(iso).getTime()) / 60_000); return m < 90 ? `${m} min` : `${Math.round(m / 60)} h` }
  return alerts.map(a => `${icon[a.kind]} *${a.fp}* — ${a.kind === 'recovered' ? `recovered after ${ago(a.since)}` : a.kind === 'still-failing' ? `still failing (${ago(a.since)})` : 'failing'}: ${a.message}`).join('\n')
}

// ─── IO ─────────────────────────────────────────────────────────────────────

const STATE_FILE = path.join(EVENTS_DIR, '.collector.json')
interface CollectorState { offset: number; openclawSince: number; automationSince: string; probes: Record<string, { status: string; at: string }>; alerts: AlertState; lastPrune?: string }

function loadState(): CollectorState {
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')) } catch { return { offset: 0, openclawSince: Date.now() - 3_600_000, automationSince: new Date(Date.now() - 3_600_000).toISOString(), probes: {}, alerts: { open: {} } } }
}

/** New complete lines in the events file since the stored offset (handles truncation). */
export function readNewEvents(state: { offset: number }, file: string = EVENTS_FILE): { events: SystemEvent[]; offset: number } {
  if (!existsSync(file)) return { events: [], offset: 0 }
  const buf = readFileSync(file)
  const start = buf.length < state.offset ? 0 : state.offset
  const chunk = buf.subarray(start).toString('utf8')
  const end = chunk.lastIndexOf('\n') + 1 // only complete lines
  const events = chunk.slice(0, end).split('\n').filter(Boolean).map(l => { try { return normalizeEvent(JSON.parse(l)) } catch { return null } }).filter((e): e is SystemEvent => !!e)
  return { events, offset: start + Buffer.byteLength(chunk.slice(0, end)) }
}

/** Keep the live file small: rotate after shipping once it passes 5 MB, keep 10 archives. */
function rotate(state: CollectorState) {
  if (!existsSync(EVENTS_FILE) || statSync(EVENTS_FILE).size < 5_000_000 || state.offset < statSync(EVENTS_FILE).size) return
  renameSync(EVENTS_FILE, path.join(EVENTS_DIR, `events-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.jsonl`))
  state.offset = 0
  const archives = readdirSync(EVENTS_DIR).filter(f => /^events-.*\.jsonl$/.test(f)).sort()
  for (const f of archives.slice(0, Math.max(0, archives.length - 10))) rmSync(path.join(EVENTS_DIR, f))
}

const sh = (cmd: string, args: string[], timeout = 30_000) => {
  try { return execFileSync(cmd, args, { encoding: 'utf8', timeout, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 20_000_000 }) } catch (e) { return (e as { stdout?: string }).stdout ?? null }
}

async function httpProbe(p: (typeof HTTP_PROBES)[number], now: Date): Promise<SystemEvent> {
  try {
    const r = await fetch(p.url, { signal: AbortSignal.timeout(8_000) })
    return ev(p.system, p.component, 'probe', r.status < 500, `${p.url} → HTTP ${r.status}`, undefined, now)
  } catch (e) {
    return ev(p.system, p.component, 'probe', false, `${p.url} unreachable: ${String((e as Error).message).slice(0, 120)}`, undefined, now)
  }
}

export async function probeAll(now: Date, state: CollectorState): Promise<SystemEvent[]> {
  const out: SystemEvent[] = []
  for (const p of HTTP_PROBES) out.push(await httpProbe(p, now))
  const docker = sh('docker', ['info', '--format', '{{.ServerVersion}}'], 20_000)
  out.push(ev('ai-stack', 'docker', 'probe', !!docker?.trim(), docker?.trim() ? `Docker ${docker.trim()} running` : 'Docker is not running: factory cycles skip without the sandbox', undefined, now))
  const launchctl = sh('launchctl', ['list'])
  if (launchctl) out.push(...launchdEvents(launchctl, now))
  const wf = sh('gh', ['workflow', 'list', '-R', 'smithdavedesign/Github-HQ', '--all', '--json', 'name,state'])
  if (wf) { try { out.push(...workflowEvents('Github-HQ', JSON.parse(wf), now)) } catch { /* skip */ } }
  const vercel = sh('vercel', ['api', '/v6/deployments?target=production&limit=100', ...(VERCEL_SCOPE ? ['--scope', VERCEL_SCOPE] : [])], 60_000)
  if (vercel) { try { out.push(...vercelEvents(JSON.parse(vercel.slice(vercel.indexOf('{'))).deployments ?? [], now)) } catch { /* skip */ } }
  const logs = sh('docker', ['logs', 'litellm', '--since', '6m'], 20_000)
  if (logs !== null) out.push(...providerEvents(logs, now))
  return out
}

/** OpenClaw cron runs finished since the last collect. */
export function openClawEvents(state: CollectorState, home = process.env.HOME ?? ''): SystemEvent[] {
  const dir = path.join(home, '.openclaw', 'cron', 'runs')
  if (!existsSync(dir)) return []
  let names = new Map<string, string>()
  try { names = new Map((JSON.parse(readFileSync(path.join(home, '.openclaw', 'cron', 'jobs.json'), 'utf8')).jobs ?? []).map((j: { id: string; name: string }) => [j.id, j.name])) } catch { /* names optional */ }
  const lines = readdirSync(dir).filter(f => f.endsWith('.jsonl')).flatMap(f => readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean).slice(-200))
  return openClawCronEvents(lines, names, state.openclawSince)
}

export async function collect(opts: { databaseUrl: string | null; slack: { token: string | null; channel: string | null }; dryRun?: boolean }): Promise<Record<string, unknown>> {
  const now = new Date()
  mkdirSync(EVENTS_DIR, { recursive: true })
  const state = loadState()
  const fromFile = readNewEvents(state)
  const fromOpenClaw = openClawEvents(state)
  const probes = probesToShip(await probeAll(now, state), state.probes, now)
  const { neon } = await import('@neondatabase/serverless')
  const sql = opts.databaseUrl ? neon(opts.databaseUrl) : null
  // RepoHQ's own automation runs (factory jobs, GitHub Actions cron routes) that failed since last time.
  let fromRuns: SystemEvent[] = []
  if (sql) {
    try {
      const rows = await sql`SELECT id, kind, status, error, finished_at FROM automation_runs WHERE finished_at > ${state.automationSince} AND status IN ('ok', 'failed') ORDER BY finished_at`
      fromRuns = (rows as Array<{ id: string; kind: string; status: string; error: string | null; finished_at: string }>).map(r => ({
        ts: new Date(r.finished_at).toISOString(), system: r.kind.startsWith('cron:') ? 'repohq' : 'factory', component: r.kind, event: 'run',
        status: r.status === 'ok' ? 'ok' : 'fail', level: r.status === 'ok' ? 'info' : 'error',
        message: r.status === 'ok' ? `${r.kind} ok` : `${r.kind} failed: ${String(r.error ?? '').slice(0, 300)}`, runId: r.id,
      } as SystemEvent))
    } catch { /* table missing on a fresh DB */ }
  }
  const all = [...fromFile.events, ...fromOpenClaw, ...fromRuns, ...probes.ship]
  // Alerts consider every probe result (not only shipped ones), so recoveries are noticed at once.
  const alertInput = [...fromFile.events, ...fromOpenClaw, ...fromRuns, ...probes.ship]
  const { alerts, state: alertState } = decideAlerts(alertInput, state.alerts, now)
  let shipped = 0
  if (sql && all.length && !opts.dryRun) {
    for (let i = 0; i < all.length; i += 200) {
      const batch = all.slice(i, i + 200)
      await sql.query(
        `INSERT INTO system_events (ts, system, component, event, status, level, message, run_id, subject, data, duration_ms, host, fingerprint) SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(ts timestamptz, system text, component text, event text, status text, level text, message text, run_id text, subject jsonb, data jsonb, duration_ms int, host text, fingerprint text)`,
        [JSON.stringify(batch.map(e => ({ ts: e.ts, system: e.system, component: e.component, event: e.event, status: e.status, level: e.level, message: e.message, run_id: e.runId ?? null, subject: e.subject ?? null, data: e.data ?? null, duration_ms: e.durationMs ?? null, host: e.host ?? null, fingerprint: fingerprint(e) })))],
      )
      shipped += batch.length
    }
  }
  let posted = false
  if (alerts.length && opts.slack.token && opts.slack.channel && !opts.dryRun) {
    const r = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8', authorization: `Bearer ${opts.slack.token}` },
      body: JSON.stringify({ channel: opts.slack.channel, text: slackText(alerts, now), unfurl_links: false }),
    }).then(x => x.json() as Promise<{ ok: boolean; error?: string }>).catch(e => ({ ok: false, error: String(e) }))
    posted = r.ok
  }
  if (sql && !opts.dryRun && state.lastPrune?.slice(0, 10) !== now.toISOString().slice(0, 10)) {
    try { await sql`DELETE FROM system_events WHERE ts < now() - interval '90 days'`; state.lastPrune = now.toISOString() } catch { /* keep going */ }
    // Once a day: every secret copy matches the keychain and is owner-only (~/ai-stack/bin/secrets logs its own event).
    sh(path.join(process.env.HOME ?? '', 'ai-stack', 'bin', 'secrets'), ['check'], 60_000)
  }
  // Something started failing or recovered: the OpenClaw agents' brief says so at their next message.
  if (alerts.length && !opts.dryRun) refreshOpenClawBrief(Object.entries(alertState.open).map(([fingerprint, o]) => ({ fingerprint, message: o.message })), now)
  if (!opts.dryRun) {
    const next: CollectorState = {
      ...state, offset: fromFile.offset, probes: probes.last, alerts: posted || !opts.slack.token ? alertState : state.alerts,
      openclawSince: Math.max(state.openclawSince, ...fromOpenClaw.map(e => Date.parse(e.ts))),
      automationSince: fromRuns.length ? fromRuns[fromRuns.length - 1]!.ts : state.automationSince,
    }
    writeFileSync(STATE_FILE, JSON.stringify(next, null, 1))
    rotate(next)
    writeFileSync(STATE_FILE, JSON.stringify(next, null, 1))
  }
  return { at: now.toISOString(), read: fromFile.events.length, openclaw: fromOpenClaw.length, runs: fromRuns.length, probes: probes.ship.length, shipped, alerts: alerts.map(a => `${a.kind} ${a.fp}`), posted }
}
