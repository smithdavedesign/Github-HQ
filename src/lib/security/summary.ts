/**
 * The Security page's view of open findings: one row per repo, its alerts grouped by package, and
 * repos nobody works on any more kept apart. Pure, so the page sends a summary instead of every
 * alert (3,000 rows made it 8 MB and 180,000 px tall).
 */

export type Severity = 'critical' | 'high' | 'medium' | 'low'
const SEVERITIES: Severity[] = ['critical', 'high', 'medium', 'low']
const RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }

/** One (repo, package, severity) group from the database. */
export interface FindingGroup {
  repoId: number
  repoName: string
  fullName: string
  isArchived: boolean | null
  lifecycleStatus: string | null
  activityStatus: string | null
  packageName: string | null
  type: string
  severity: string
  count: number
  newest: Date | null
  /** One title from the group: a package's advisory, or the finding itself when there's no package. */
  title: string
}

export interface PackageAlerts { name: string; severity: Severity; count: number; title: string }

export interface RepoSecurity {
  repoId: number
  repoName: string
  fullName: string
  counts: Record<Severity, number>
  total: number
  newest: Date | null
  /** Worst first, then most alerts; capped by `maxPackages`. */
  packages: PackageAlerts[]
  morePackages: number
  /** Why it's in the quiet section, or null for repos in use. */
  quietReason: string | null
}

export interface SecuritySummary {
  totals: Record<Severity, number>
  active: RepoSecurity[]
  quiet: RepoSecurity[]
}

const sev = (s: string): Severity => (SEVERITIES.includes(s as Severity) ? (s as Severity) : 'low')

/** Archived, sunsetting or dormant repos: their alerts matter less than the ones in repos in use. */
export function quietReason(r: Pick<FindingGroup, 'isArchived' | 'lifecycleStatus' | 'activityStatus'>): string | null {
  if (r.isArchived) return 'archived on GitHub'
  if (r.lifecycleStatus === 'archived') return 'archived'
  if (r.lifecycleStatus === 'sunsetting') return 'sunsetting'
  if (r.activityStatus === 'Dormant' || r.activityStatus === 'Abandoned') return r.activityStatus.toLowerCase()
  return null
}

export function summarizeFindings(groups: FindingGroup[], maxPackages = 6): SecuritySummary {
  const totals: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 }
  const repos = new Map<number, RepoSecurity & { byPackage: Map<string, PackageAlerts> }>()
  for (const g of groups) {
    const s = sev(g.severity)
    totals[s] += g.count
    let r = repos.get(g.repoId)
    if (!r) {
      r = { repoId: g.repoId, repoName: g.repoName, fullName: g.fullName, counts: { critical: 0, high: 0, medium: 0, low: 0 }, total: 0,
        newest: null, packages: [], morePackages: 0, quietReason: quietReason(g), byPackage: new Map() }
      repos.set(g.repoId, r)
    }
    r.counts[s] += g.count
    r.total += g.count
    if (g.newest && (!r.newest || g.newest > r.newest)) r.newest = g.newest
    const key = g.packageName ?? `${g.type}: ${g.title}`
    const p = r.byPackage.get(key)
    if (!p) r.byPackage.set(key, { name: g.packageName ?? g.title, severity: s, count: g.count, title: g.title })
    else {
      p.count += g.count
      if (RANK[s] < RANK[p.severity]) { p.severity = s; p.title = g.title }
    }
  }
  const out: RepoSecurity[] = [...repos.values()].map(({ byPackage, ...r }) => {
    const all = [...byPackage.values()].sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.count - a.count || a.name.localeCompare(b.name))
    return { ...r, packages: all.slice(0, maxPackages), morePackages: Math.max(0, all.length - maxPackages) }
  })
  const worst = (a: RepoSecurity, b: RepoSecurity) =>
    b.counts.critical - a.counts.critical || b.counts.high - a.counts.high || b.total - a.total || a.repoName.localeCompare(b.repoName)
  return {
    totals,
    active: out.filter(r => !r.quietReason).sort(worst),
    quiet: out.filter(r => r.quietReason).sort(worst),
  }
}
