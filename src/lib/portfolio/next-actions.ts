/**
 * "What should I do next?" (30-day experiment, roadmap "Experiment A"). Instead of 66 health
 * scores, every active repo gets a decision state with the reasons behind it and one next
 * action, and only the few that deserve attention are shown. Deterministic and explainable:
 * no model call, every reason is a fact from the data.
 *
 * Pure, relative imports only: the dashboard and the factory's morning report both use it.
 */

export type DecisionState = 'blocked' | 'build' | 'explore' | 'reconsider' | 'maintain' | 'archive'

export const DECISION_LABEL: Record<DecisionState, string> = {
  blocked: 'Blocked', build: 'Build', explore: 'Explore', reconsider: 'Reconsider', maintain: 'Maintain', archive: 'Archive',
}

export interface RepoSignals {
  id: number
  name: string
  fullName: string
  lifecycleStatus: string | null
  isFocused: boolean
  isArchived: boolean
  purpose: string | null
  mrr: number
  hasProductionUrl: boolean
  healthScore: number | null
  activityStatus: string | null
  buildStatus: string | null
  /** null = never pushed / unknown. */
  daysSincePush: number | null
  openPrs: number
  archiveScore: number
  criticalAlerts: number
  highAlerts: number
  /** On the factory's allowlist: it can fix red CI and patch dependencies itself. */
  factoryManaged: boolean
}

export interface Decision {
  repoId: number
  name: string
  fullName: string
  state: DecisionState
  reasons: string[]
  nextAction: string
  /** Higher = more deserving of attention today. */
  priority: number
}

export interface NextActions {
  /** The few that deserve attention, highest priority first. */
  attention: Decision[]
  /** Active repos per state (archived repos are not counted). */
  counts: Record<DecisionState, number>
  /** Repos suggested for archiving, best candidate first. */
  archiveSuggestions: Decision[]
  activeRepos: number
}

const BUILDING = new Set(['building', 'beta', 'growing'])
const LIVE = new Set(['production', 'growing', 'beta'])
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

/** Worth protecting: you chose it, it earns, it's live, or it's in active development. */
function isValuable(r: RepoSignals): boolean {
  return r.isFocused || r.mrr > 0 || r.hasProductionUrl || LIVE.has(r.lifecycleStatus ?? '')
}

function valueReasons(r: RepoSignals): string[] {
  return [
    ...(r.isFocused ? ['a focus project'] : []),
    ...(r.mrr > 0 ? [`earns $${Math.round(r.mrr)}/mo`] : []),
    ...(r.hasProductionUrl ? ['has a live URL'] : []),
    ...(r.lifecycleStatus && r.lifecycleStatus !== 'maintaining' ? [`lifecycle: ${r.lifecycleStatus}`] : []),
  ]
}

export function decide(r: RepoSignals): Decision {
  const base = { repoId: r.id, name: r.name, fullName: r.fullName }
  const valuable = isValuable(r)
  const alerts = r.criticalAlerts + r.highAlerts
  const idle = r.daysSincePush === null ? 'never pushed' : `no push in ${r.daysSincePush} days`

  // Valuable but something is broken: fix that before anything else.
  if (valuable && (r.buildStatus === 'failure' || alerts > 0)) {
    const reasons = [
      ...(r.buildStatus === 'failure' ? ['CI is red on the default branch'] : []),
      ...(alerts > 0 ? [`${plural(alerts, 'critical/high security alert')} open`] : []),
      ...valueReasons(r),
    ]
    const fix = r.buildStatus === 'failure' ? 'Fix the red CI' : `Patch the ${plural(alerts, 'alert')}`
    return {
      ...base, state: 'blocked', reasons,
      nextAction: r.factoryManaged ? `${fix} — on the factory allowlist, so it can take this` : `${fix} (not on the factory allowlist, so it's yours)`,
      priority: 100 + Math.min(r.mrr, 50) + (r.isFocused ? 20 : 0) + r.criticalAlerts * 2,
    }
  }

  if (r.isFocused || BUILDING.has(r.lifecycleStatus ?? '')) {
    const reasons = [...valueReasons(r), ...(r.daysSincePush !== null ? [r.daysSincePush <= 7 ? 'active this week' : idle] : [])]
    if (r.openPrs > 0) {
      return { ...base, state: 'build', reasons: [...reasons, `${plural(r.openPrs, 'open PR')}`], nextAction: `Review the ${plural(r.openPrs, 'open PR')} first`, priority: 80 + (r.isFocused ? 10 : 0) }
    }
    if (r.daysSincePush !== null && r.daysSincePush > 14) {
      return { ...base, state: 'build', reasons, nextAction: 'Stalled: pick one next step, or move it out of focus', priority: 70 + (r.isFocused ? 10 : 0) }
    }
    return { ...base, state: 'build', reasons, nextAction: 'Keep going', priority: 40 + (r.isFocused ? 10 : 0) }
  }

  if (r.lifecycleStatus === 'idea') {
    return {
      ...base, state: 'explore', reasons: ['lifecycle: idea', ...(r.purpose ? [`purpose: ${r.purpose}`] : ['no purpose written down'])],
      nextAction: 'Time-box a 2-hour prototype, or archive it', priority: 35,
    }
  }

  if (r.lifecycleStatus === 'sunsetting') {
    return { ...base, state: 'reconsider', reasons: ['lifecycle: sunsetting', idle], nextAction: 'Finish sunsetting: archive, or reverse the decision', priority: 50 }
  }

  if (!valuable && (r.archiveScore >= 60 || (r.daysSincePush !== null && r.daysSincePush > 180))) {
    return {
      ...base, state: 'archive',
      reasons: ['no focus, revenue or live URL', idle, ...(r.archiveScore >= 60 ? [`archive score ${Math.round(r.archiveScore)}`] : [])],
      nextAction: 'Archive it on GitHub (keep anything reusable)', priority: 20 + Math.min(r.archiveScore, 100) / 10,
    }
  }

  const reasons = valuable ? valueReasons(r) : [r.activityStatus ? r.activityStatus.toLowerCase() : 'no recent signal']
  return { ...base, state: 'maintain', reasons, nextAction: r.openPrs > 0 ? `Review the ${plural(r.openPrs, 'open PR')}` : 'Nothing needed', priority: r.openPrs > 0 ? 45 : 0 }
}

/** Attention list: blocked and actionable repos above the line; quiet repos are only counted. */
export function nextActions(repos: readonly RepoSignals[], limit = 3): NextActions {
  const active = repos.filter(r => !r.isArchived && r.lifecycleStatus !== 'archived')
  const decisions = active.map(decide)
  const counts: Record<DecisionState, number> = { blocked: 0, build: 0, explore: 0, reconsider: 0, maintain: 0, archive: 0 }
  for (const d of decisions) counts[d.state]++
  const byPriority = (a: Decision, b: Decision) => b.priority - a.priority || a.name.localeCompare(b.name)
  return {
    attention: decisions.filter(d => d.state !== 'archive' && d.priority >= 35).sort(byPriority).slice(0, limit),
    counts,
    archiveSuggestions: decisions.filter(d => d.state === 'archive').sort(byPriority),
    activeRepos: active.length,
  }
}

/** Plain-text lines for the morning report. */
export function nextActionLines(n: NextActions): string[] {
  if (n.activeRepos === 0) return ['No active repos synced yet.']
  const states = (Object.keys(n.counts) as DecisionState[]).filter(s => n.counts[s] > 0).map(s => `${n.counts[s]} ${DECISION_LABEL[s].toLowerCase()}`)
  return [
    `${plural(n.activeRepos, 'active repo')}: ${states.join(' · ')}. ${n.attention.length ? `${n.attention.length} deserve attention:` : 'Nothing needs you today.'}`,
    ...n.attention.map((d, i) => `${i + 1}. ${d.name} — ${DECISION_LABEL[d.state].toUpperCase()}: ${d.nextAction}. Why: ${d.reasons.join('; ')}.`),
    ...(n.archiveSuggestions.length ? [`Archive candidates (${n.archiveSuggestions.length}): ${n.archiveSuggestions.slice(0, 5).map(d => d.name).join(', ')}${n.archiveSuggestions.length > 5 ? ', …' : ''}.`] : []),
  ]
}
