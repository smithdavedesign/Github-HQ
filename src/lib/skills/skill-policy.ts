/**
 * Pure gstack skill constants — no auth/DB imports, safe for unit tests.
 */

export type GstackSkill =
  | 'investigate' | 'review'
  | 'qa-only' | 'qa'
  | 'ship' | 'document-release' | 'cso'
  | 'health' | 'canary'
  | 'retro'
  | ShowSkill

/**
 * The show-production skills (2026-11-27, the owner: "a skill similar to the gstack for producing a show, with a
 * producer skill, writer skill, asset builder skill"). gstack-style roles for a repo that runs a show (Botchelor):
 * each is a SKILL.md in the repo's own `.claude/skills/<name>/`, which the factory's prompt tells the agent to follow.
 * Offered only on show repos (isShowRepo).
 */
export type ShowSkill = 'show-producer' | 'show-writer' | 'show-assets' | 'show-editor'
export const SHOW_SKILLS: readonly ShowSkill[] = ['show-producer', 'show-writer', 'show-assets', 'show-editor']

/** Repos that run a show: tagged `show`, or Botchelor itself. */
const SHOW_REPOS = new Set(['smithdavedesign/botchelor'])
export function isShowRepo(repoFullName: string, tags: string[] | null | undefined): boolean {
  return SHOW_REPOS.has(repoFullName.toLowerCase()) || Boolean(tags?.some((t) => t.toLowerCase() === 'show'))
}
export function isShowSkill(skill: string): skill is ShowSkill {
  return (SHOW_SKILLS as readonly string[]).includes(skill)
}
/** Each show skill's default objective, for the launcher and MCP. */
export function showSkillObjectives(repoName: string): Record<ShowSkill, string> {
  return {
    'show-producer': `Read the season's clock and the show's surfaces in ${repoName} and return a ranked beat sheet: what should the show build or stage next for more drama and better visuals`,
    'show-writer': `Punch up the show's in-world words in ${repoName} on the surface the beat sheet names, in the show's voice and every language`,
    'show-assets': `Build the next visual the show needs in ${repoName} (a share card, poster, promo cut or set), wired into its page with a test that it renders`,
    'show-editor': `Review the show's pages in ${repoName} like an editor watching a cut: does it read like TV, does it spoil, does it work on a phone and in every language`,
  }
}

const VALID_SKILLS = new Set<GstackSkill>([
  'investigate', 'review', 'qa-only', 'qa',
  'ship', 'document-release', 'cso', 'health', 'canary', 'retro',
  ...SHOW_SKILLS,
])

export type AdvisorImpactType = 'opportunity' | 'revenue' | 'security' | 'health'
export type SkillPolicyTier = 'report-only' | 'analyze+fix' | 'high-risk'
export type ConfidenceBand = 'low' | 'medium' | 'high'

/** A security item is fixed the safe way (/cso: npm audit fix, never --force); it used to get a read-only /investigate. */
export function resolveAdvisorSkill(impactType: AdvisorImpactType): GstackSkill {
  return impactType === 'security' ? 'cso' : 'ship'
}

const REPORT_ONLY_SKILLS = new Set<GstackSkill>(['health', 'qa-only', 'review', 'canary', 'retro', 'show-producer', 'show-editor'])

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

// What each skill does when the factory runs it (roadmap Phase 81, docs/agent-hq-migration-prd.md §8):
// `pr` skills become one judged draft PR; `report` skills a read-only investigation with findings.
export const SKILL_META: Record<GstackSkill, SkillMeta> = {
  investigate: {
    label: '/investigate', phase: 'Understand', type: 'report',
    description: 'Finds the root cause of a bug, security alert or failing build and proposes the fix — read-only. Queue /ship with the proposal to apply it.',
    icon: 'Search', iconColor: 'text-red-500',
    typeLabel: 'Report only', typeBadgeColor: 'bg-red-50 text-red-600 border-red-200',
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
    label: '/qa', phase: 'Build Quality', type: 'pr',
    description: 'Finds bugs in the area you describe and fixes them in the source, keeping every check green — one judged draft PR.',
    icon: 'Search', iconColor: 'text-orange-500',
    typeLabel: 'Creates PR', typeBadgeColor: 'bg-orange-50 text-orange-600 border-orange-200',
  },
  ship: {
    label: '/ship', phase: 'Ship', type: 'pr',
    description: 'Implements the objective as one small change, runs the repo\'s checks and opens a draft PR. Use when you have a clear task.',
    icon: 'GitPullRequest', iconColor: 'text-indigo-500',
    typeLabel: 'Creates PR', typeBadgeColor: 'bg-indigo-50 text-indigo-600 border-indigo-200',
  },
  cso: {
    label: '/cso', phase: 'Ship', type: 'pr',
    description: 'Fixes security alerts the safe way: npm audit fix (never --force) in the repo and every sub-package lockfile, as one judged PR. What only a breaking upgrade fixes is left, and the PR says how much.',
    icon: 'ShieldCheck', iconColor: 'text-red-500',
    typeLabel: 'Creates PR', typeBadgeColor: 'bg-red-50 text-red-600 border-red-200',
  },
  'document-release': {
    label: '/document-release', phase: 'Ship', type: 'pr',
    description: 'Updates README, docs and CHANGELOG to match the code — documentation only, as a draft PR. Run after merging a PR.',
    icon: 'BookOpen', iconColor: 'text-blue-500',
    typeLabel: 'Creates PR', typeBadgeColor: 'bg-blue-50 text-blue-600 border-blue-200',
  },
  health: {
    label: '/health', phase: 'Monitor', type: 'report',
    description: 'Scores type checking, tests, lint, and dead code — whichever apply to this stack. Produces a report with findings — no changes.',
    icon: 'Heart', iconColor: 'text-emerald-500',
    typeLabel: 'Report only', typeBadgeColor: 'bg-emerald-50 text-emerald-600 border-emerald-200',
  },
  canary: {
    label: '/canary', phase: 'Monitor', type: 'report',
    description: 'Not available in the factory: checking a live app needs a browser and network access the sandbox does not have.',
    icon: 'Tv', iconColor: 'text-violet-500',
    typeLabel: 'Unavailable', typeBadgeColor: 'bg-violet-50 text-violet-600 border-violet-200',
  },
  retro: {
    label: '/retro', phase: 'Reflect', type: 'report',
    description: "Analyses this week's commits — patterns, wins, growth areas. Run on Mondays for a weekly snapshot.",
    icon: 'RotateCcw', iconColor: 'text-cyan-500',
    typeLabel: 'Report only', typeBadgeColor: 'bg-cyan-50 text-cyan-600 border-cyan-200',
  },
  // The show's production roles (ShowSkill): only on show repos, each following the repo's .claude/skills/<name>/SKILL.md.
  'show-producer': {
    label: '/show-producer', phase: 'Show', type: 'report',
    description: "The executive producer: reads the season's clock and the story machinery, then returns a ranked beat sheet of bets (impact, effort, where each lands). Queue the top one as /show-writer or /show-assets.",
    icon: 'Clapperboard', iconColor: 'text-rose-500',
    typeLabel: 'Report only', typeBadgeColor: 'bg-rose-50 text-rose-600 border-rose-200',
  },
  'show-writer': {
    label: '/show-writer', phase: 'Show', type: 'pr',
    description: "Writes the show's in-world words — ceremony lines, exits, twists, teases, empty states — in its voice and inside its safety rules, translated. One judged draft PR.",
    icon: 'PenLine', iconColor: 'text-pink-500',
    typeLabel: 'Creates PR', typeBadgeColor: 'bg-pink-50 text-pink-600 border-pink-200',
  },
  'show-assets': {
    label: '/show-assets', phase: 'Show', type: 'pr',
    description: 'Builds the show\'s visuals — share cards and posters, Remotion promo cuts, sets — wired into the pages, with a test that each renders. One judged draft PR.',
    icon: 'Image', iconColor: 'text-fuchsia-500',
    typeLabel: 'Creates PR', typeBadgeColor: 'bg-fuchsia-50 text-fuchsia-600 border-fuchsia-200',
  },
  'show-editor': {
    label: '/show-editor', phase: 'Show', type: 'report',
    description: "Reviews the show's pages like an editor watching a cut: TV not database, no spoilers, the drama visible, phone-first, every language. Findings with fixes.",
    icon: 'Eye', iconColor: 'text-purple-500',
    typeLabel: 'Report only', typeBadgeColor: 'bg-purple-50 text-purple-600 border-purple-200',
  },
}
