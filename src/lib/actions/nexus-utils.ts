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

export function isGstackSkill(value: unknown): value is GstackSkill {
  return typeof value === 'string' && VALID_SKILLS.has(value as GstackSkill)
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
