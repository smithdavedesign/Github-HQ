/**
 * PR value rating (30-day experiment, roadmap "Experiment B"). Merged is not the same as useful,
 * so the owner rates a factory PR by adding one GitHub label when they merge or close it:
 * `value:0` … `value:5`. One click, works from GitHub mobile, and needs no app UI. The factory's
 * reconcile step reads the label into the ledger and `agent_jobs.value`.
 *
 * Pure, relative imports only: the factory and the app both use it.
 */

export const PR_VALUE_SCALE = [
  { value: 0, name: 'noise', description: 'Should not have been opened' },
  { value: 1, name: 'maintenance', description: 'Harmless upkeep, no real difference' },
  { value: 2, name: 'useful', description: 'Worth having; would have done it eventually' },
  { value: 3, name: 'meaningful', description: 'Noticeably improved the project' },
  { value: 4, name: 'strategic', description: 'Moved something I care about forward' },
  { value: 5, name: 'material', description: 'Real, measurable value' },
] as const

/** A PR counts as useful from this value up (the gate's "worth reviewing" bar). */
export const USEFUL_PR_VALUE = 2

/** The labels the factory creates in each allowlisted repo (`gh label create --force`). */
export const PR_VALUE_LABELS = PR_VALUE_SCALE.map(s => ({
  name: `value:${s.value}`,
  description: `${s.name}: ${s.description}`,
  color: ['9ca3af', 'd1d5db', 'bfdbfe', '60a5fa', '2563eb', '1e3a8a'][s.value],
}))

/** The rating carried by a PR's labels; the highest wins if several are present. null = unrated. */
export function prValueFromLabels(labels: readonly string[]): number | null {
  let best: number | null = null
  for (const l of labels) {
    const m = /^value:([0-5])$/.exec(l.trim().toLowerCase())
    if (m) best = Math.max(best ?? 0, Number(m[1]))
  }
  return best
}
