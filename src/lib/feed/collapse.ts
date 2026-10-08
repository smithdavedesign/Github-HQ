/**
 * Collapse repeated events into one row with a count. In the 2026-10 audit the Activity Log and
 * Portfolio Feed were ~90 copies of the same "Agent execution failed: git clone …" line, which
 * buried everything else. Pure.
 */

/** Same message modulo numbers, ids, paths' variable parts and whitespace. */
export function repeatKey(...parts: (string | number | null | undefined)[]): string {
  return parts
    .map(p => String(p ?? '').toLowerCase().replace(/[0-9a-f]{8,}/g, '#').replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().slice(0, 160))
    .join('|')
}

/** Keeps the first occurrence of each key (the newest, for newest-first input) and counts the rest. */
export function collapseRepeats<T>(items: T[], key: (item: T) => string): { item: T; count: number }[] {
  const out: { item: T; count: number }[] = []
  const index = new Map<string, number>()
  for (const item of items) {
    const k = key(item)
    const at = index.get(k)
    if (at === undefined) {
      index.set(k, out.length)
      out.push({ item, count: 1 })
    } else {
      out[at].count++
    }
  }
  return out
}
