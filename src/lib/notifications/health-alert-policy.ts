/**
 * When a low health score is worth a notification. Before the 2026-10 audit every repo below the
 * threshold re-alerted weekly ("health dropped to 45" for repos that had sat at 45 for years,
 * archived coursework included): 615 alerts, none of them news. Pure.
 */

/** A repo already alerted is only re-alerted after falling at least this much further. */
export const REALERT_DROP = 5

export function shouldAlertHealth(p: {
  health: number | null | undefined
  threshold: number
  /** Score at this repo's most recent health alert, or null if it was never alerted. */
  lastAlertedScore: number | null
  /** Archived or sunsetting: expected to be quiet. */
  retired: boolean
}): boolean {
  if (p.retired || p.health == null || p.health >= p.threshold) return false
  return p.lastAlertedScore === null || p.health <= p.lastAlertedScore - REALERT_DROP
}
