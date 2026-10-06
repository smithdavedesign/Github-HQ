/**
 * Pure gstack skill constants — no auth/DB imports, safe for unit tests.
 */

export type GstackSkill =
  | 'investigate' | 'review'
  | 'qa-only' | 'qa'
  | 'ship' | 'document-release'
  | 'health' | 'canary'
  | 'retro'

const VALID_SKILLS = new Set<GstackSkill>([
  'investigate', 'review', 'qa-only', 'qa',
  'ship', 'document-release', 'health', 'canary', 'retro',
])

export type AdvisorImpactType = 'opportunity' | 'revenue' | 'security' | 'health'
export type SkillPolicyTier = 'report-only' | 'analyze+fix' | 'high-risk'
export type ConfidenceBand = 'low' | 'medium' | 'high'

export function resolveAdvisorSkill(impactType: AdvisorImpactType): GstackSkill {
  return impactType === 'security' ? 'investigate' : 'ship'
}

const REPORT_ONLY_SKILLS = new Set<GstackSkill>(['health', 'qa-only', 'review', 'canary', 'retro'])

export function resolveSkillPolicyTier(skill: GstackSkill, impactType?: AdvisorImpactType): SkillPolicyTier {
  if (REPORT_ONLY_SKILLS.has(skill)) return 'report-only'
  if (impactType === 'security' || skill === 'investigate') return 'high-risk'
  return 'analyze+fix'
}

export function resolveConfidenceBand(successRate: number, dataPoints: number, minDataPoints: number): ConfidenceBand {
  if (dataPoints < minDataPoints) return 'low'
  if (successRate >= 80) return 'high'
  if (successRate >= 50) return 'medium'
  return 'low'
}

export function isTierAllowedForLifecycle(tier: SkillPolicyTier, lifecycleStatus: string | null | undefined): boolean {
  const stage = lifecycleStatus ?? 'maintaining'

  if (tier === 'report-only') {
    return stage !== 'archived'
  }

  if (tier === 'analyze+fix') {
    return ['building', 'beta', 'production', 'growing', 'maintaining'].includes(stage)
  }

  return ['beta', 'production', 'growing', 'maintaining'].includes(stage)
}

export function isTierAllowedByConfidence(tier: SkillPolicyTier, confidence: ConfidenceBand): boolean {
  if (tier === 'report-only') return true
  if (tier === 'analyze+fix') return confidence !== 'low'
  return confidence === 'high'
}

/**
 * Progressive autonomy gate:
 * - low-risk tiers (`report-only`, `analyze+fix`) auto-run by default
 * - `high-risk` requires explicit per-repo opt-in
 *
 * Repo opt-in tag: gstack-optin:high-risk
 * Optional env override JSON (highest precedence):
 * REPO_GSTACK_HIGH_RISK_OPT_IN_JSON={"owner/repo":true}
 */
export function parseEnvHighRiskOptInMap(raw: string | undefined): Map<string, boolean> {
  if (!raw) return new Map()

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const map = new Map<string, boolean>()
    for (const [repoFullName, value] of Object.entries(parsed)) {
      map.set(repoFullName, value === true)
    }
    return map
  } catch {
    return new Map()
  }
}

export function isHighRiskOptedIn(
  repoFullName: string,
  tags: string[] | null | undefined,
  envOptInMap: Map<string, boolean>,
): boolean {
  const envOverride = envOptInMap.get(repoFullName)
  if (envOverride != null) return envOverride

  if (!tags?.length) return false
  return tags.some((t) => t.toLowerCase() === 'gstack-optin:high-risk')
}

export function isTierAllowedByProgressiveAutonomy(
  tier: SkillPolicyTier,
  repoFullName: string,
  tags: string[] | null | undefined,
  envOptInMap: Map<string, boolean>,
): boolean {
  if (tier !== 'high-risk') return true
  return isHighRiskOptedIn(repoFullName, tags, envOptInMap)
}

export function isGstackSkill(value: unknown): value is GstackSkill {
  return typeof value === 'string' && VALID_SKILLS.has(value as GstackSkill)
}

/**
 * Repo-level allowlist parser from tags.
 *
 * Supported forms:
 * - gstack-allow:ship,investigate
 * - gstack-allow:all
 */
export function parseRepoSkillAllowlist(tags: string[] | null | undefined): Set<GstackSkill> | null {
  if (!tags?.length) return null

  const prefix = 'gstack-allow:'
  const tag = tags.find((t) => t.toLowerCase().startsWith(prefix))
  if (!tag) return null

  const value = tag.slice(prefix.length).trim().toLowerCase()
  if (!value || value === 'all' || value === '*') return null

  const skills = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s): s is GstackSkill => isGstackSkill(s))

  return new Set(skills)
}

/**
 * Optional env override map for hard policy by repo full name.
 *
 * Example:
 * REPO_GSTACK_SKILL_ALLOWLIST_JSON={"owner/repo":["ship","investigate"]}
 */
export function parseEnvSkillAllowlistMap(raw: string | undefined): Map<string, Set<GstackSkill>> {
  if (!raw) return new Map()

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const map = new Map<string, Set<GstackSkill>>()

    for (const [repoFullName, value] of Object.entries(parsed)) {
      if (!Array.isArray(value)) continue
      const skills = value
        .map((s) => (typeof s === 'string' ? s.trim() : ''))
        .filter((s): s is GstackSkill => isGstackSkill(s))
      map.set(repoFullName, new Set(skills))
    }

    return map
  } catch {
    return new Map()
  }
}

export function isSkillAllowedForRepo(
  skill: GstackSkill,
  repoFullName: string,
  repoTagAllowlist: Set<GstackSkill> | null,
  envAllowlistMap: Map<string, Set<GstackSkill>>,
): boolean {
  const envAllowlist = envAllowlistMap.get(repoFullName)
  if (envAllowlist) return envAllowlist.has(skill)
  if (repoTagAllowlist) return repoTagAllowlist.has(skill)
  return true
}

export interface SkillMeta {
  label: string
  phase: string
  type: 'report' | 'fix' | 'pr'
  description: string
  /** Lucide icon component name — resolved via a local ICON_MAP in the UI layer */
  icon: string
  iconColor: string
  typeLabel: string
  typeBadgeColor: string
}

export const SKILL_META: Record<GstackSkill, SkillMeta> = {
  investigate: {
    label: '/investigate', phase: 'Understand', type: 'fix',
    description: 'Diagnoses root cause then fixes if safe. Best for bugs, security alerts, or failing builds.',
    icon: 'Search', iconColor: 'text-red-500',
    typeLabel: 'Analyze + Fix', typeBadgeColor: 'bg-red-50 text-red-600 border-red-200',
  },
  review: {
    label: '/review', phase: 'Understand', type: 'report',
    description: 'Pre-merge code review. Surfaces security issues, logic errors, and structural problems — no changes.',
    icon: 'Eye', iconColor: 'text-slate-500',
    typeLabel: 'Report only', typeBadgeColor: 'bg-slate-50 text-slate-600 border-slate-200',
  },
  'qa-only': {
    label: '/qa-only', phase: 'Build Quality', type: 'report',
    description: 'Finds bugs and documents them with repro steps. No fixes — pure report so you decide what to act on.',
    icon: 'FileText', iconColor: 'text-amber-500',
    typeLabel: 'Report only', typeBadgeColor: 'bg-amber-50 text-amber-600 border-amber-200',
  },
  qa: {
    label: '/qa', phase: 'Build Quality', type: 'fix',
    description: 'Finds bugs and iteratively fixes them with atomic commits. Re-verifies after each fix.',
    icon: 'Search', iconColor: 'text-orange-500',
    typeLabel: 'Analyze + Fix', typeBadgeColor: 'bg-orange-50 text-orange-600 border-orange-200',
  },
  ship: {
    label: '/ship', phase: 'Ship', type: 'pr',
    description: 'Full release pipeline — implement objective, run tests, open PR. Use when you have a clear task.',
    icon: 'GitPullRequest', iconColor: 'text-indigo-500',
    typeLabel: 'Creates PR', typeBadgeColor: 'bg-indigo-50 text-indigo-600 border-indigo-200',
  },
  'document-release': {
    label: '/document-release', phase: 'Ship', type: 'fix',
    description: 'Updates README, docs, and CHANGELOG to match what was shipped. Run after merging a PR.',
    icon: 'BookOpen', iconColor: 'text-blue-500',
    typeLabel: 'Commits', typeBadgeColor: 'bg-blue-50 text-blue-600 border-blue-200',
  },
  health: {
    label: '/health', phase: 'Monitor', type: 'report',
    description: 'Scores type checking, tests, lint, and dead code — whichever apply to this stack. Produces a report with findings — no changes.',
    icon: 'Heart', iconColor: 'text-emerald-500',
    typeLabel: 'Report only', typeBadgeColor: 'bg-emerald-50 text-emerald-600 border-emerald-200',
  },
  canary: {
    label: '/canary', phase: 'Monitor', type: 'report',
    description: 'Checks the live app for console errors and performance regressions. Requires a deployment URL.',
    icon: 'Tv', iconColor: 'text-violet-500',
    typeLabel: 'Report only', typeBadgeColor: 'bg-violet-50 text-violet-600 border-violet-200',
  },
  retro: {
    label: '/retro', phase: 'Reflect', type: 'report',
    description: "Analyses this week's commits — patterns, wins, growth areas. Run on Mondays for a weekly snapshot.",
    icon: 'RotateCcw', iconColor: 'text-cyan-500',
    typeLabel: 'Report only', typeBadgeColor: 'bg-cyan-50 text-cyan-600 border-cyan-200',
  },
}
