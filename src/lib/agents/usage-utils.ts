/**
 * The Agents page's second worker and the scarce subscriptions, from the system log (docs/logging.md)
 * plus the idea pipeline's tables. Pure, so it can be tested:
 *   - the idea pipeline's runs (research, review, build) and what's building right now;
 *   - Claude Pro usage by the idea pipeline (the owner's own Claude Code sessions share it, uncounted);
 *   - GitHub Copilot usage by the factory (factory/copilot/usage snapshots, factory/lib/copilot-quota.ts).
 * Older events carry less (no data, no duration): what's missing reads as unknown, never as zero.
 */
import type { BuildSlot, IdeaPolicy } from '@/lib/ideas/idea-utils'

export interface LogEvent {
  ts: Date
  system: string
  component: string
  event: string
  status: string
  message: string
  durationMs: number | null
  subject: { idea?: string; pr?: string; repo?: string } | null
  data: Record<string, unknown> | null
}

export type IdeaRunKind = 'research' | 'review' | 'build'
const KINDS: IdeaRunKind[] = ['research', 'review', 'build']

export interface IdeaRun {
  at: Date
  kind: IdeaRunKind
  idea: string | null
  status: 'ok' | 'fail' | 'start'
  durationMs: number | null
  model: string | null
  engine: 'claude' | 'free' | null
  /** Ran on something weaker than asked: the free pool, or Sonnet for an Opus build. */
  fellBack: boolean
  /** A research run for an idea the owner sent ("idea: …"), outside the 09:00 run. */
  seeded: boolean
  milestone: string | null
  manual: boolean
  prUrl: string | null
  summary: string
}

const HOUR = 3_600_000
const DAY = 24 * HOUR
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null)

/** idea-factory's research, review and build events as runs, newest first. */
export function ideaRuns(events: LogEvent[]): IdeaRun[] {
  const out: IdeaRun[] = []
  for (const e of events) {
    if (e.system !== 'idea-factory' || !KINDS.includes(e.component as IdeaRunKind)) continue
    if (e.status !== 'ok' && e.status !== 'fail' && e.status !== 'start') continue
    const d = e.data ?? {}
    const kind = e.component as IdeaRunKind
    const engineText = str(d.engine) ?? e.message.match(/\bengine (claude|free)\b/)?.[1] ?? (kind === 'research' ? 'claude' : null)
    const engine = engineText === 'free' ? 'free' : engineText === 'claude' ? 'claude' : null
    out.push({
      at: e.ts, kind, idea: e.subject?.idea ?? null, status: e.status,
      durationMs: e.durationMs,
      model: str(d.model) ?? e.message.match(/\bon (claude-[\w.-]+)/)?.[1] ?? null,
      engine,
      fellBack: bool(d.fellBack) ?? engine === 'free',
      seeded: d.trigger === 'seed' || /\(seeded\)/.test(e.message),
      milestone: str(d.milestone) ?? (kind === 'build' ? e.event : null),
      manual: d.manual === true || /Start build now/.test(e.message),
      prUrl: e.subject?.pr ?? str(d.prUrl),
      summary: e.message,
    })
  }
  return out.sort((a, b) => b.at.getTime() - a.at.getTime())
}

/** Builds that started and haven't reported back, within their timeout plus a margin. */
export function runningBuilds(runs: IdeaRun[], now: Date, timeoutMinutes = 45): IdeaRun[] {
  const latest = new Map<string, IdeaRun>()
  for (const r of runs) if (r.kind === 'build' && r.idea && !latest.has(r.idea)) latest.set(r.idea, r) // newest first
  return [...latest.values()].filter(r => r.status === 'start' && now.getTime() - r.at.getTime() < (timeoutMinutes + 15) * 60_000)
}

/** Messages that mean the subscription couldn't take the work (idea-factory lib/claude.js capacityFailure). */
const CAPACITY = /usage limit|limit reached|rate.?limit|\b429\b|quota|overloaded|\b529\b|not logged in|couldn't take the work/i

export interface UsageWindow {
  runs: number
  byKind: Record<IdeaRunKind, number>
  /** Sum of the durations the events carry; `minutesPartial` when some runs didn't say. */
  minutes: number
  minutesPartial: boolean
  fellBack: number
  failed: number
}

export interface ClaudeUsage {
  day: UsageWindow
  week: UsageWindow
  lastCapacity: { at: Date; message: string } | null
}

function windowOf(runs: IdeaRun[]): UsageWindow {
  const byKind: Record<IdeaRunKind, number> = { research: 0, review: 0, build: 0 }
  let ms = 0
  let partial = false
  for (const r of runs) {
    byKind[r.kind]++
    if (r.durationMs === null) partial = true
    else ms += r.durationMs
  }
  return { runs: runs.length, byKind, minutes: Math.round(ms / 60_000), minutesPartial: partial, fellBack: runs.filter(r => r.fellBack).length, failed: runs.filter(r => r.status === 'fail').length }
}

/** The idea pipeline's Claude Pro use in the last 24 hours and 7 days, and the last capacity hit. */
export function claudeUsage(events: LogEvent[], now: Date): ClaudeUsage {
  const finished = ideaRuns(events).filter(r => r.status !== 'start')
  const since = (ms: number) => finished.filter(r => now.getTime() - r.at.getTime() < ms)
  const capacity = events
    .filter(e => e.system === 'idea-factory' && ((e.component === 'claude' && e.event === 'capacity') || (e.status === 'fail' && CAPACITY.test(e.message))))
    .sort((a, b) => b.ts.getTime() - a.ts.getTime())[0]
  return { day: windowOf(since(DAY)), week: windowOf(since(7 * DAY)), lastCapacity: capacity ? { at: capacity.ts, message: capacity.message } : null }
}

export interface CopilotUsage {
  at: Date
  installed: boolean
  plan: string | null
  percentRemaining: number | null
  overagePermitted: boolean | null
  resetDate: string | null
  tasksToday: number
  maxTasksPerDay: number
  reviewsToday: number
  maxReviewsPerDay: number
  /** Older than a day: the counts are from that day, not today. */
  stale: boolean
}

/** The newest factory/copilot/usage snapshot, or null before the first one. */
export function copilotUsage(latest: LogEvent | null, now: Date): CopilotUsage | null {
  if (!latest?.data) return null
  const d = latest.data
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
  return {
    at: latest.ts,
    installed: d.installed !== false,
    plan: str(d.plan),
    percentRemaining: typeof d.percentRemaining === 'number' ? d.percentRemaining : null,
    overagePermitted: bool(d.overagePermitted),
    resetDate: str(d.resetDate),
    tasksToday: num(d.tasksToday, 0), maxTasksPerDay: num(d.maxTasksPerDay, 0),
    reviewsToday: num(d.reviewsToday, 0), maxReviewsPerDay: num(d.maxReviewsPerDay, 0),
    stale: now.getTime() - latest.ts.getTime() > DAY,
  }
}

export interface IdeaLimits {
  manual: { used: number; cap: number }
  weekly: BuildSlot
  seeded: { used: number; cap: number }
}

/** The caps the owner chose (idea-factory policy.json), against the last 24 hours and this week. */
export function ideaLimits(input: { manualStarts: Date[]; weekly: BuildSlot; runs: IdeaRun[]; policy: IdeaPolicy | null; now: Date }): IdeaLimits {
  const { now, policy } = input
  const recent = (d: Date) => now.getTime() - d.getTime() < DAY
  return {
    manual: { used: input.manualStarts.filter(recent).length, cap: policy?.build?.manualPerDay ?? 2 },
    weekly: input.weekly,
    seeded: { used: input.runs.filter(r => r.kind === 'research' && r.seeded && r.status !== 'start' && recent(r.at)).length, cap: policy?.research?.seeded?.maxPerDay ?? 3 },
  }
}

/** "claude-opus-5-5 · xhigh", "free pool (free-agent)", or null. */
export function engineText(r: Pick<IdeaRun, 'engine' | 'model'>, effort?: string | null): string | null {
  if (r.engine === 'free') return `free pool${r.model ? ` (${r.model})` : ''}`
  if (!r.model) return r.engine === 'claude' ? 'Claude' : null
  return `${r.model}${effort ? ` · ${effort}` : ''}`
}
