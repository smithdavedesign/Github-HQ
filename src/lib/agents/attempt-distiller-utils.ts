const MAX_ACTION_KEY_LEN = 60

export interface AttemptRecord {
  action: string
  outcome?: 'success' | 'failed' | 'partial'
  reason?: string
}

export interface ActionSummary {
  action: string
  successRate: number
  total: number
  commonFailure: string | null
}

/**
 * Groups attempt records by normalized action (lowercased, truncated to 60
 * chars — same normalization as `getDeadEndActions` in mcp/server.ts) and
 * computes a success rate + most common failure reason per group. Sorted by
 * `total` descending so the most-attempted actions surface first.
 */
export function distillByAction(attempts: AttemptRecord[]): ActionSummary[] {
  const byAction = new Map<string, AttemptRecord[]>()
  for (const a of attempts) {
    const key = a.action.toLowerCase().slice(0, MAX_ACTION_KEY_LEN)
    const list = byAction.get(key) ?? []
    list.push(a)
    byAction.set(key, list)
  }

  return Array.from(byAction.entries())
    .map(([action, items]) => {
      const total = items.length
      const successes = items.filter(i => i.outcome === 'success').length
      const successRate = Math.round((successes / total) * 100) / 100

      const failureReasons = new Map<string, number>()
      for (const i of items) {
        if (i.outcome === 'failed' && i.reason) {
          failureReasons.set(i.reason, (failureReasons.get(i.reason) ?? 0) + 1)
        }
      }
      let commonFailure: string | null = null
      let maxCount = 0
      for (const [reason, count] of failureReasons) {
        if (count > maxCount) { maxCount = count; commonFailure = reason }
      }

      return { action, successRate, total, commonFailure }
    })
    .sort((a, b) => b.total - a.total)
}
