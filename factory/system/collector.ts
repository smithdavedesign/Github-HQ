/**
 * The system-events collector (docs/logging.md). launchd runs it every 5 minutes:
 *   1. read new lines from ~/.system-events/events.jsonl (any system writes there);
 *   2. add probes nobody else runs: local services (LiteLLM, Ollama, Headroom, OpenClaw, Docker), launchd
 *      jobs, OpenClaw cron runs, GitHub Actions cron state, failed RepoHQ automation runs, and provider
 *      errors in LiteLLM's log (out of credit, auth, rate limits);
 *   3. ship to Neon `system_events` (redacted), at most once an hour (NEON_SHIP_MS);
 *   4. post failures and recoveries to Slack (deduplicated: one alert per failure, repeated every 6h).
 * Pure parts are exported for tests; IO is at the bottom.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { EVENTS_DIR, EVENTS_FILE, emitEvent, fingerprint, normalizeEvent, type SystemEvent } from './events'
import { refreshOpenClawBrief } from '../context/brief'

// ─── What's watched ─────────────────────────────────────────────────────────

/** launchd jobs: daemons must be running; interval jobs must have exited 0 last time. */
export const WATCHED_JOBS: Array<{ label: string; kind: 'daemon' | 'interval'; system: string; component: string }> = [
  { label: 'com.repohq.factory.worker', kind: 'daemon', system: 'factory', component: 'worker' },
  { label: 'ai.openclaw.gateway', kind: 'daemon', system: 'openclaw', component: 'gateway' },
  { label: 'com.localai.headroom', kind: 'daemon', system: 'ai-stack', component: 'headroom' },
  { label: 'com.user.caffeinate-ac', kind: 'daemon', system: 'ai-stack', component: 'caffeinate' },
  { label: 'com.user.idea-pipeline', kind: 'interval', system: 'idea-factory', component: 'pipeline' },
  { label: 'com.user.repohq-frontdoor-report', kind: 'interval', system: 'openclaw', component: 'frontdoor' },
  { label: 'com.user.system-events', kind: 'interval', system: 'ai-stack', component: 'collector' },
  { label: 'com.user.factory-backup', kind: 'interval', system: 'factory', component: 'backup' },
  { label: 'com.repohq.factory.deploy', kind: 'interval', system: 'factory', component: 'self-deploy' },
  { label: 'com.localai.media-gen', kind: 'interval', system: 'ai-stack', component: 'media-gen' },
  // Ollama isn't watched as a launchd job: Ollama.app owns :11434, so homebrew.mxcl.ollama exits 1 by design and
  // com.ollama.ollama sits idle while Ollama runs (a false "not running" every 5 minutes until 2026-10-19). The
  // HTTP probe on :11434 below is what says whether it's up.
]

const VERCEL_SCOPE = process.env.VERCEL_SCOPE ?? 'team_ONe0JJaVwgXIAUMHZ7OUgkku'

/**
 * How often the collector touches RepoHQ's Neon database: reading automation runs, shipping events, probing the app
 * (its health check queries Neon). Neon suspends after 5 idle minutes, so touching it every 5 minutes kept it awake
 * around the clock and used up the free plan's 100 compute-hours by 2026-10-25, which took RepoHQ down until the
 * quota reset. Everything else, Slack alerts included, still runs every 5 minutes.
 */
export const NEON_SHIP_MS = 60 * 60_000

/** Due once NEON_SHIP_MS has passed since the last shipment that went through (a minute early, for launchd's jitter). */
export function neonDue(lastShip: string | undefined, now: Date): boolean {
  return !lastShip || now.getTime() - new Date(lastShip).getTime() >= NEON_SHIP_MS - 60_000
}

/** Probes marked `wakesNeon` query RepoHQ's database, so they run only when shipping is due. */
export const HTTP_PROBES: Array<{ system: string; component: string; url: string; auth?: 'litellm'; wakesNeon?: true }> = [
  { system: 'ai-stack', component: 'litellm', url: 'http://127.0.0.1:4000/health/liveliness' },
  { system: 'ai-stack', component: 'ollama', url: 'http://127.0.0.1:11434/api/version' },
  { system: 'ai-stack', component: 'headroom', url: 'http://127.0.0.1:8787/health' },
  { system: 'openclaw', component: 'gateway', url: 'http://127.0.0.1:18789/' },
  { system: 'repohq', component: 'app', url: 'https://repohq.vercel.app/api/health', wakesNeon: true },
  // Live products: 503 when the app can't reach its database (botchelor docs/launch-readiness.md).
  { system: 'vercel', component: 'botchelor', url: 'https://botchelor.com/api/health' },
]

/**
 * Live products whose health endpoint has a token-gated detail: what needs the owner, beyond being up. The token is
 * the product's cron secret, read from the keychain at probe time; liveness itself is the plain HTTP probe above.
 */
export const PRODUCT_HEALTH: Array<{ project: string; url: string; tokenService: string; adminUrl: string; wakesNeon?: true }> = [
  { project: 'botchelor', url: 'https://botchelor.com/api/health', tokenService: 'vault/botchelor/CRON_SECRET', adminUrl: 'https://botchelor.com/admin' },
  // RepoHQ reports server errors only: its pages sit behind sign-in, so a crash there never fails the liveness probe.
  { project: 'repohq', url: 'https://repohq.vercel.app/api/health', tokenService: 'vault/repohq/CRON_SECRET', adminUrl: 'https://repohq.vercel.app', wakesNeon: true },
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

/**
 * The outcome of posting alerts to Slack, as an event: a failed post is a failure of its own, or every alert would go
 * unseen without a trace (2026-10-14: the bot was dropped from #team-agents by an app reinstall, two days of alerts lost
 * quietly). A recovery is logged once, after a failure; quiet successes aren't.
 */
export function slackPostEvent(r: { ok: boolean; error?: string }, wasFailing: boolean, now = new Date()): SystemEvent | null {
  if (r.ok) return wasFailing ? ev('repohq', 'collector', 'slack-post', true, 'alerts reach Slack #team-agents again', undefined, now) : null
  const fix = r.error === 'not_in_channel' ? ': the bot is not in the channel, so in #team-agents type /invite @repohqmessage'
    : /invalid_auth|token_revoked|account_inactive/.test(r.error ?? '') ? ': the Slack token was refused, so store the current bot token in the keychain (system-events-slack-token)' : ''
  return ev('repohq', 'collector', 'slack-post', false, `alerts not posted to Slack: ${r.error ?? 'unknown error'}${fix}`, undefined, now)
}

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

/** Local image/video jobs (ai-stack bin/media-gen) waiting longer than this are stuck: a video takes at most ~40 min. */
export const MEDIA_STUCK_MS = 60 * 60_000

/** Ages of the jobs waiting in ~/.local/state/media-gen-inbox → one event: fails when the oldest has waited past MEDIA_STUCK_MS. */
export function mediaQueueEvent(jobMtimesMs: number[], now = new Date()): SystemEvent {
  if (!jobMtimesMs.length) return ev('ai-stack', 'media-gen', 'probe', true, 'no image/video jobs waiting', undefined, now)
  const ageMin = Math.round((now.getTime() - Math.min(...jobMtimesMs)) / 60_000)
  const ok = ageMin * 60_000 <= MEDIA_STUCK_MS
  return ev('ai-stack', 'media-gen', 'probe', ok, ok
    ? `${jobMtimesMs.length} image/video job(s) queued, oldest ${ageMin} min`
    : `image/video job stuck for ${ageMin} min (${jobMtimesMs.length} waiting): see ~/.local/state/media-gen.log and comfyui.log`, { queued: jobMtimesMs.length, oldestMin: ageMin }, now)
}

/**
 * OpenClaw's model-router plugin state (~/.local/state/model-router.json) → one event. While the free cloud models are
 * rate-limited it routes chats to the local 7B, so the companion is slower and weaker: worth one alert and one recovery
 * (2026-10-16: every free provider hit its limit at once and the companion reset its memory).
 */
export function modelRouterEvent(state: { cloudLimitedUntil?: number; reason?: string } | null, now = new Date()): SystemEvent {
  const until = state?.cloudLimitedUntil ?? 0
  if (until <= now.getTime()) return ev('openclaw', 'model-router', 'probe', true, 'OpenClaw is on the free cloud models', undefined, now)
  return ev('openclaw', 'model-router', 'probe', false,
    `free cloud models rate-limited (${state?.reason ?? 'rate limit'}): OpenClaw on local-chat until ${new Date(until).toISOString().slice(11, 16)} UTC`, { until: new Date(until).toISOString() }, now)
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

export interface ProductHealth {
  reports?: { episodes?: number; reports?: number; oldest_at?: string | null }
  stuck_generating?: number
  paid_dates?: { today?: number; cap?: number }
  errors?: { last_hour?: number; latest?: { kind?: string; route?: string; message?: string } | null }
}

/**
 * A product's health detail → one event per thing the owner may have to act on, each ok when there's nothing:
 * reports waiting for review, dates stuck generating, and the paid-model daily cap being reached (dates then run
 * on the free model until 00:00 UTC, which is either a good day or abuse).
 */
export function productHealthEvents(project: string, adminUrl: string, h: ProductHealth, now = new Date()): SystemEvent[] {
  const out: SystemEvent[] = []
  if (h.reports) {
    const n = h.reports.episodes ?? 0
    out.push(ev('vercel', project, 'reports', n === 0,
      n === 0 ? `${project}: no reports waiting` : `${project}: ${n} reported episode${n === 1 ? '' : 's'} waiting for review at ${adminUrl}`,
      n ? { episodes: n, reports: h.reports.reports ?? n, oldest_at: h.reports.oldest_at ?? null } : undefined, now))
  }
  if (typeof h.stuck_generating === 'number') {
    const n = h.stuck_generating
    out.push(ev('vercel', project, 'stuck-dates', n === 0,
      n === 0 ? `${project}: no dates stuck generating` : `${project}: ${n} date${n === 1 ? '' : 's'} stuck generating for 15+ minutes`, undefined, now))
  }
  if (typeof h.paid_dates?.today === 'number' && typeof h.paid_dates.cap === 'number') {
    const { today, cap } = h.paid_dates
    const reached = cap > 0 && today >= cap
    out.push(ev('vercel', project, 'paid-cap', !reached,
      reached ? `${project}: paid-model cap reached (${today}/${cap} today); dates run on the free model until 00:00 UTC` : `${project}: ${today}/${cap} paid-model dates today`, undefined, now))
  }
  if (typeof h.errors?.last_hour === 'number') {
    const n = h.errors.last_hour
    const l = h.errors.latest
    out.push(ev('vercel', project, 'errors', n === 0,
      n === 0 ? `${project}: no server errors in the last hour`
        : `${project}: ${n} server error${n === 1 ? '' : 's'} in the last hour${l ? ` (latest ${l.kind ?? '?'} ${l.route ?? ''}: ${String(l.message ?? '').slice(0, 160)})` : ''}`,
      n ? { last_hour: n, route: l?.route ?? null } : undefined, now))
  }
  return out
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
interface CollectorState { offset: number; openclawSince: number; automationSince: string; probes: Record<string, { status: string; at: string }>; alerts: AlertState; lastPrune?: string; lastShip?: string; slackFailing?: boolean }

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

async function productHealthProbe(p: (typeof PRODUCT_HEALTH)[number], now: Date): Promise<SystemEvent[]> {
  const token = sh('security', ['find-generic-password', '-s', p.tokenService, '-w'], 10_000)?.trim()
  if (!token) return [] // no token on this machine: the liveness probe still runs
  try {
    const r = await fetch(p.url, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8_000) })
    if (!r.ok) return [] // an outage is the liveness probe's to report
    return productHealthEvents(p.project, p.adminUrl, await r.json() as ProductHealth, now)
  } catch {
    return []
  }
}

export async function probeAll(now: Date, state: CollectorState, neon: boolean): Promise<SystemEvent[]> {
  const out: SystemEvent[] = []
  for (const p of HTTP_PROBES) if (neon || !p.wakesNeon) out.push(await httpProbe(p, now))
  for (const p of PRODUCT_HEALTH) if (neon || !p.wakesNeon) out.push(...await productHealthProbe(p, now))
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
  out.push(...localStateEvents(now))
  return out
}

/** ai-stack state files: the media-gen queue and the OpenClaw model router (only on a Mac that has them). */
function localStateEvents(now: Date, home = process.env.HOME ?? ''): SystemEvent[] {
  const out: SystemEvent[] = []
  const inbox = path.join(home, '.local', 'state', 'media-gen-inbox')
  if (existsSync(inbox)) {
    try { out.push(mediaQueueEvent(readdirSync(inbox).filter(f => f.endsWith('.json')).map(f => statSync(path.join(inbox, f)).mtimeMs), now)) } catch { /* skip */ }
  }
  const router = path.join(home, '.local', 'state', 'model-router.json')
  if (existsSync(router)) {
    try { out.push(modelRouterEvent(JSON.parse(readFileSync(router, 'utf8')), now)) } catch { /* skip */ }
  }
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
  const { neon } = await import('@neondatabase/serverless')
  const sql = opts.databaseUrl ? neon(opts.databaseUrl) : null
  // Between shipments nothing touches Neon: the file offset, OpenClaw cursor and probe history stay where the last
  // shipment left them, so the next one sends everything. Alerts re-read the same events each run, which is safe:
  // decideAlerts acts on each fingerprint's latest status.
  const due = !!sql && neonDue(state.lastShip, now)
  const fromFile = readNewEvents(state)
  const fromOpenClaw = openClawEvents(state)
  const probed = await probeAll(now, state, due)
  const probes = probesToShip(probed, state.probes, now)
  let fromRuns: SystemEvent[] = []
  let shipped = 0
  let neonEvent: SystemEvent | null = null
  if (sql && due && !opts.dryRun) {
    try {
      // RepoHQ's own automation runs (factory jobs, GitHub Actions cron routes) that finished since last time.
      try {
        const rows = await sql`SELECT id, kind, status, error, finished_at FROM automation_runs WHERE finished_at > ${state.automationSince} AND status IN ('ok', 'failed') ORDER BY finished_at`
        fromRuns = (rows as Array<{ id: string; kind: string; status: string; error: string | null; finished_at: string }>).map(r => ({
          ts: new Date(r.finished_at).toISOString(), system: r.kind.startsWith('cron:') ? 'repohq' : 'factory', component: r.kind, event: 'run',
          status: r.status === 'ok' ? 'ok' : 'fail', level: r.status === 'ok' ? 'info' : 'error',
          message: r.status === 'ok' ? `${r.kind} ok` : `${r.kind} failed: ${String(r.error ?? '').slice(0, 300)}`, runId: r.id,
        } as SystemEvent))
      } catch { /* table missing on a fresh DB */ }
      const all = [...fromFile.events, ...fromOpenClaw, ...fromRuns, ...probes.ship]
      for (let i = 0; i < all.length; i += 200) {
        const batch = all.slice(i, i + 200)
        await sql.query(
          `INSERT INTO system_events (ts, system, component, event, status, level, message, run_id, subject, data, duration_ms, host, fingerprint) SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(ts timestamptz, system text, component text, event text, status text, level text, message text, run_id text, subject jsonb, data jsonb, duration_ms int, host text, fingerprint text)`,
          [JSON.stringify(batch.map(e => ({ ts: e.ts, system: e.system, component: e.component, event: e.event, status: e.status, level: e.level, message: e.message, run_id: e.runId ?? null, subject: e.subject ?? null, data: e.data ?? null, duration_ms: e.durationMs ?? null, host: e.host ?? null, fingerprint: fingerprint(e) })))],
        )
        shipped += batch.length
      }
      neonEvent = ev('repohq', 'neon', 'ship', true, `system log shipped to Neon (${shipped} events)`, undefined, now)
    } catch (e) {
      // Nothing advances, so the next run (5 minutes on, due again) retries; Slack still hears about it below.
      neonEvent = ev('repohq', 'neon', 'ship', false, `Neon won't take the system log, so RepoHQ's database is likely down: ${String((e as Error).message).slice(0, 300)}`, undefined, now)
      fromRuns = []
      shipped = 0
    }
  }
  const neonOk = neonEvent?.status === 'ok'
  // Alerts consider every probe result (not only shipped ones), so recoveries are noticed at once.
  const alertInput = [...fromFile.events, ...fromOpenClaw, ...fromRuns, ...probed, ...(neonEvent ? [neonEvent] : [])]
  const { alerts, state: alertState } = decideAlerts(alertInput, state.alerts, now)
  let posted = false
  if (alerts.length && opts.slack.token && opts.slack.channel && !opts.dryRun) {
    const r = await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST', headers: { 'content-type': 'application/json; charset=utf-8', authorization: `Bearer ${opts.slack.token}` },
      body: JSON.stringify({ channel: opts.slack.channel, text: slackText(alerts, now), unfurl_links: false }),
    }).then(x => x.json() as Promise<{ ok: boolean; error?: string }>).catch(e => ({ ok: false, error: String(e) }))
    posted = r.ok
    const outcome = slackPostEvent(r, !!state.slackFailing, now)
    if (outcome) emitEvent(outcome) // read back next cycle, so it reaches Neon, the report's "Failing now" and the agents' brief
    state.slackFailing = !r.ok
  }
  if (sql && neonOk && state.lastPrune?.slice(0, 10) !== now.toISOString().slice(0, 10)) {
    try { await sql`DELETE FROM system_events WHERE ts < now() - interval '90 days'`; state.lastPrune = now.toISOString() } catch { /* keep going */ }
    // Once a day: every secret copy matches the keychain and is owner-only (~/ai-stack/bin/secrets logs its own event).
    sh(path.join(process.env.HOME ?? '', 'ai-stack', 'bin', 'secrets'), ['check'], 60_000)
  }
  // Something started failing or recovered: the OpenClaw agents' brief says so at their next message.
  if (alerts.length && !opts.dryRun) refreshOpenClawBrief(Object.entries(alertState.open).map(([fingerprint, o]) => ({ fingerprint, message: o.message })), now)
  if (!opts.dryRun) {
    const next: CollectorState = {
      ...state, alerts: posted || !opts.slack.token ? alertState : state.alerts,
      ...(neonOk || !sql ? {
        offset: fromFile.offset, probes: probes.last, lastShip: neonOk ? now.toISOString() : state.lastShip,
        openclawSince: Math.max(state.openclawSince, ...fromOpenClaw.map(e => Date.parse(e.ts))),
        automationSince: fromRuns.length ? fromRuns[fromRuns.length - 1]!.ts : state.automationSince,
      } : {}),
    }
    writeFileSync(STATE_FILE, JSON.stringify(next, null, 1))
    rotate(next)
    writeFileSync(STATE_FILE, JSON.stringify(next, null, 1))
  }
  return { at: now.toISOString(), neon: !due || opts.dryRun ? 'later' : neonOk ? 'shipped' : 'failed', read: fromFile.events.length, openclaw: fromOpenClaw.length, runs: fromRuns.length, probes: probes.ship.length, shipped, alerts: alerts.map(a => `${a.kind} ${a.fp}`), posted }
}
