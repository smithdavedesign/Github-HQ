/**
 * When a low health score is worth a notification. Before the 2026-10 audit every repo below the
 * threshold re-alerted weekly ("health dropped to 45" for repos that had sat at 45 for years,
 * archived coursework included): 615 alerts, none of them news. Pure.
 */

/** A repo already alerted is only re-alerted after falling at least this much further. */
export const REALERT_DROP = 5

/**
 * A repo younger than this isn't alerted: a new repo (an idea repo before its first build) scores low for
 * being new, not for falling. 2026-10-13: four idea repos approved overnight each sent "health dropped to 35".
 * Still low after that, it's alerted like any other.
 */
export const YOUNG_DAYS = 14

export function shouldAlertHealth(p: {
  health: number | null | undefined
  threshold: number
  /** Score at this repo's most recent health alert, or null if it was never alerted. */
  lastAlertedScore: number | null
  /** Archived or sunsetting: expected to be quiet. */
  retired: boolean
  /** Created less than YOUNG_DAYS ago. */
  young?: boolean
}): boolean {
  if (p.retired || p.young || p.health == null || p.health >= p.threshold) return false
  return p.lastAlertedScore === null || p.health <= p.lastAlertedScore - REALERT_DROP
}
