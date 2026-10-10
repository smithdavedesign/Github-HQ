/**
 * System events: one log format for every part of the system (docs/logging.md).
 *
 * Any writer, in any language, appends one JSON line per event to ~/.system-events/events.jsonl:
 *   {"ts":"2026-10-10T20:00:00Z","system":"idea-factory","component":"pipeline","event":"tick",
 *    "status":"fail","level":"error","message":"…","runId":"…","subject":{"idea":"permitly"},"data":{…}}
 * The collector (collector.ts, launchd every 5 min) adds its own probes, ships everything to Neon
 * (`system_events`), and alerts Slack on failures and recoveries.
 *
 * The file is the source and works offline; Neon is the index. Secrets are redacted before shipping.
 */
import { appendFileSync, mkdirSync } from 'node:fs'
import { homedir, hostname } from 'node:os'
import path from 'node:path'

export const EVENTS_DIR = process.env.SYSTEM_EVENTS_DIR ?? path.join(homedir(), '.system-events')
export const EVENTS_FILE = path.join(EVENTS_DIR, 'events.jsonl')

export type EventStatus = 'ok' | 'fail' | 'start' | 'skipped' | 'info'
export type EventLevel = 'info' | 'warn' | 'error'

export interface SystemEvent {
  ts: string
  system: string        // repohq | factory | idea-factory | ai-stack | openclaw | resource-center | launchd | github
  component: string     // e.g. pipeline, worker, litellm, cron:idea-to-repo
  event: string         // what happened, short: tick, probe, run, build, post
  status: EventStatus
  level: EventLevel
  message: string
  runId?: string
  subject?: { repo?: string; idea?: string; pr?: string }
  data?: Record<string, unknown>
  durationMs?: number
  host?: string
}

const SYSTEMS = new Set(['repohq', 'factory', 'idea-factory', 'ai-stack', 'openclaw', 'resource-center', 'launchd', 'github', 'vercel', 'slack'])

/** Tokens and keys never leave the machine in a log line. */
const SECRET_PATTERNS: RegExp[] = [
  /\bsk-[A-Za-z0-9_-]{8,}/g, /\bxox[abprs]-[A-Za-z0-9-]{8,}/g, /\bxapp-[A-Za-z0-9-]{8,}/g, /\bntn_[A-Za-z0-9]{8,}/g,
  /\bsecret_[A-Za-z0-9]{8,}/g, /\bgh[pousr]_[A-Za-z0-9]{20,}/g, /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bAIza[0-9A-Za-z_-]{20,}/g, /\bBearer\s+[A-Za-z0-9._-]{12,}/gi, /postgres(ql)?:\/\/[^\s"']+/gi,
  /\b[A-Fa-f0-9]{32}\.[A-Za-z0-9_-]{16,}\b/g, // Ollama-style keys
]

export function redact(text: string): string {
  let out = String(text)
  for (const re of SECRET_PATTERNS) out = out.replace(re, '[redacted]')
  return out
}

function redactDeep(v: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]'
  if (typeof v === 'string') return redact(v).slice(0, 4000)
  if (Array.isArray(v)) return v.slice(0, 50).map(x => redactDeep(x, depth + 1))
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).slice(0, 50).map(([k, x]) => [k, /token|secret|password|key$/i.test(k) ? '[redacted]' : redactDeep(x, depth + 1)]))
  return v
}

/** Validate and clean an event from any writer; null when it isn't one. */
export function normalizeEvent(raw: unknown): SystemEvent | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const str = (k: string, max = 200) => (typeof r[k] === 'string' ? (r[k] as string).trim().slice(0, max) : '')
  const system = str('system', 40)
  const component = str('component', 80)
  const event = str('event', 80)
  if (!system || !component || !event) return null
  const status = (['ok', 'fail', 'start', 'skipped', 'info'] as const).find(s => s === r.status) ?? 'info'
  const level = (['info', 'warn', 'error'] as const).find(l => l === r.level) ?? (status === 'fail' ? 'error' : 'info')
  const ts = typeof r.ts === 'string' && !Number.isNaN(Date.parse(r.ts)) ? new Date(r.ts).toISOString()
    : typeof r.ts === 'number' ? new Date(r.ts).toISOString() : new Date().toISOString()
  const subject = r.subject && typeof r.subject === 'object' ? redactDeep(r.subject) as SystemEvent['subject'] : undefined
  return {
    ts, system: SYSTEMS.has(system) ? system : `other:${system}`, component, event, status, level,
    message: redact(str('message', 2000)),
    ...(str('runId', 120) ? { runId: str('runId', 120) } : {}),
    ...(subject ? { subject } : {}),
    ...(r.data && typeof r.data === 'object' ? { data: redactDeep(r.data) as Record<string, unknown> } : {}),
    ...(typeof r.durationMs === 'number' ? { durationMs: Math.round(r.durationMs) } : {}),
    host: str('host', 80) || hostname(),
  }
}

/** What an alert is about: the same failure repeating is one alert, not one per run. */
export function fingerprint(e: Pick<SystemEvent, 'system' | 'component' | 'event'>): string {
  return `${e.system}:${e.component}:${e.event}`
}

/** Append an event to the shared file. Never throws: logging must not break the thing it logs. */
export function emitEvent(e: Omit<SystemEvent, 'ts' | 'level' | 'host'> & Partial<Pick<SystemEvent, 'ts' | 'level'>>): void {
  try {
    const ev = normalizeEvent({ ts: new Date().toISOString(), ...e })
    if (!ev) return
    mkdirSync(EVENTS_DIR, { recursive: true })
    appendFileSync(EVENTS_FILE, JSON.stringify(ev) + '\n')
  } catch { /* logging is best-effort */ }
}
