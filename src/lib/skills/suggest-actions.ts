/**
 * Pure skill suggestion engine — no React, no auth/DB imports.
 * Infers which gstack skill to run next based on findings from a completed report.
 */

export type SuggestableSkill = 'ship' | 'investigate'

export interface SuggestedAction {
  skill: SuggestableSkill
  label: string
  objective: string
}

/** Number of findings shown before "Show N more" toggle in the UI. */
export const FINDINGS_PREVIEW_COUNT = 4

/** Max suggested actions shown per skill report. */
export const MAX_SUGGESTIONS = 2

// Lines starting with these prefixes are passing checks, not problems.
// Prevents matching "✅ TypeScript: 0 compile issues" as a TypeScript error.
const PASSING_PREFIXES = ['✅', '✓', '☑', 'passing', 'clean:', '0 errors', '0 issues', 'all tests']

function stripPassingFindings(findings: string[]): string[] {
  return findings.filter(f => {
    const lower = f.trim().toLowerCase()
    return !PASSING_PREFIXES.some(p => lower.startsWith(p))
  })
}

interface MatchRule {
  skills: string[]
  keywords: string[]
  action: Omit<SuggestedAction, 'objective'>
  objectiveTpl: string  // {repo} is replaced with repoName
}

// Specific rules — checked first, ordered by severity.
const MATCH_RULES: MatchRule[] = [
  {
    skills: ['health', 'qa-only'],
    keywords: ['typescript', 'type error', 'ts error', 'tsc error', 'compile error'],
    action: { skill: 'ship', label: 'Fix TypeScript errors' },
    objectiveTpl: 'Fix all TypeScript errors found in the /health report for {repo}. Focus on type safety and correct exports.',
  },
  {
    skills: ['health', 'qa-only'],
    keywords: ['dead code', 'never imported', 'unused export', 'unused function', 'unused variable'],
    action: { skill: 'ship', label: 'Remove dead code' },
    objectiveTpl: 'Remove the dead code and unused exports identified in the /health report for {repo}.',
  },
  {
    skills: ['health', 'qa-only'],
    keywords: ['no test', 'missing test', 'untested', 'coverage gap', 'test coverage', 'zero test'],
    action: { skill: 'ship', label: 'Add missing tests' },
    objectiveTpl: 'Add unit tests for the untested functions identified in the /health report for {repo}.',
  },
  {
    skills: ['health', 'qa-only'],
    keywords: ['build fail', 'build error', 'compile failed', 'module not found'],
    action: { skill: 'investigate', label: 'Investigate failing build' },
    objectiveTpl: 'Investigate and fix the build failures found in the /health report for {repo}.',
  },
  {
    skills: ['review'],
    keywords: ['security', 'vulnerability', 'injection', 'auth bypass', 'csrf', 'xss', 'ssrf'],
    action: { skill: 'investigate', label: 'Investigate security findings' },
    objectiveTpl: 'Investigate and fix the security issues found in the /review report for {repo}.',
  },
  {
    skills: ['review'],
    keywords: ['logic error', 'incorrect', 'should return', 'wrong value', 'bug'],
    action: { skill: 'ship', label: 'Fix logic issues' },
    objectiveTpl: 'Fix the logic issues and code quality problems found in the /review report for {repo}.',
  },
  {
    skills: ['qa-only'],
    keywords: ['race condition', 'concurrency', 'async bug', 'data race'],
    action: { skill: 'investigate', label: 'Investigate concurrency bug' },
    objectiveTpl: 'Investigate the concurrency issue found in the /qa-only report for {repo}.',
  },
  {
    skills: ['retro'],
    keywords: ['test', 'quality', 'coverage', 'tech debt', 'refactor'],
    action: { skill: 'ship', label: 'Address technical debt' },
    objectiveTpl: 'Address the technical debt patterns identified in this week\'s retro for {repo}.',
  },
]

// Generic fallback — only fires when no specific rule matched.
const GENERIC_RULES: MatchRule[] = [
  {
    skills: ['health', 'qa-only'],
    keywords: ['⚠️', 'error', 'issue', 'warning', 'failed'],
    action: { skill: 'ship', label: 'Fix reported issues' },
    objectiveTpl: 'Fix the issues identified in the /health report for {repo}.',
  },
]

/**
 * Returns up to MAX_SUGGESTIONS actions inferred from skill findings.
 * - Filters out passing/clean findings before matching (avoids false positives)
 * - De-dupes by skill — max one /ship and one /investigate
 * - Objectives include the most relevant finding text for precision
 * - Generic fallback only fires when no specific rule matched
 */
export function getSuggestedActions(
  skillName: string | undefined,
  findings: string[],
  repoName: string,
): SuggestedAction[] {
  if (!skillName || findings.length === 0) return []

  const problemFindings = stripPassingFindings(findings)
  if (problemFindings.length === 0) return []

  const text = problemFindings.join(' ').toLowerCase()
  const actions: SuggestedAction[] = []
  const seenSkills = new Set<SuggestableSkill>()

  function addIfNew(rule: MatchRule, triggeringFinding?: string) {
    if (!rule.skills.includes(skillName!)) return
    if (seenSkills.has(rule.action.skill)) return
    seenSkills.add(rule.action.skill)

    let objective = rule.objectiveTpl.replace('{repo}', repoName)
    // Append the specific finding so the agent knows exactly what to fix
    if (triggeringFinding) {
      const snippet = triggeringFinding.length > 120
        ? triggeringFinding.slice(0, 117) + '…'
        : triggeringFinding
      objective += ` Specifically: ${snippet}`
    }

    actions.push({ ...rule.action, objective })
  }

  for (const rule of MATCH_RULES) {
    if (actions.length >= MAX_SUGGESTIONS) break
    if (rule.keywords.some(kw => text.includes(kw))) {
      // Find the first finding that triggered this rule
      const trigger = problemFindings.find(f =>
        rule.keywords.some(kw => f.toLowerCase().includes(kw))
      )
      addIfNew(rule, trigger)
    }
  }

  if (actions.length === 0) {
    for (const rule of GENERIC_RULES) {
      if (actions.length >= MAX_SUGGESTIONS) break
      if (rule.keywords.some(kw => text.includes(kw))) {
        const trigger = problemFindings.find(f =>
          rule.keywords.some(kw => f.toLowerCase().includes(kw))
        )
        addIfNew(rule, trigger)
      }
    }
  }

  return actions
}
