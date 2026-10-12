import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Convert Drizzle's numeric/string DB values to a JS number. Returns 0 for null/undefined. */
export function toNum(value: unknown): number {
  if (value == null) return 0
  const n = parseFloat(String(value))
  return isNaN(n) ? 0 : n
}

/**
 * "5m ago". Pass `now` (e.g. the server's snapshot time) when the text is rendered on the server
 * and hydrated: measured against the clock, it can cross a bucket in between ("just now" → "1m ago").
 */
export function formatDistanceToNow(date: Date | string | null, now: number = Date.now()): string {
  if (!date) return '—'
  const d = date instanceof Date ? date : new Date(date)
  const seconds = Math.floor((now - d.getTime()) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 86400 * 30) return `${Math.floor(seconds / 86400)}d ago`
  if (seconds < 86400 * 365) return `${Math.floor(seconds / (86400 * 30))}mo ago`
  return `${Math.floor(seconds / (86400 * 365))}y ago`
}

/**
 * A long error as one readable line: a log's last "Error:" line if it has one, else the text with
 * whitespace collapsed and git's "hint:" lines dropped; cut at `max` with an ellipsis. Show the full
 * text on hover or behind a toggle where it matters.
 */
export function errorSummary(text: string | null | undefined, max = 160): string {
  const raw = String(text ?? '')
  const errorLine = raw.split('\n').map(l => l.replace(/^\s*\[[^\]]*\]\s*/, '').trim()).filter(l => /^(error|fatal)\b/i.test(l)).at(-1)
  const one = (errorLine ?? raw).replace(/\s+/g, ' ').replace(/\s*\bhint:.*$/i, '').trim()
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one
}
