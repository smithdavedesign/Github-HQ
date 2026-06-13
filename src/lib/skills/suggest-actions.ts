/**
 * Pure skill suggestion engine — no React, no auth/DB imports.
 * Infers which gstack skill to run next based on findings from a completed report.
 */

export type SuggestableSkill = 'ship' | 'investigate' | 'health' | 'canary' | 'qa-only'

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
  // Security issues always take priority — investigate before fixing
  {
    skills: ['health', 'qa-only', 'review'],
    keywords: ['security', 'vulnerability', 'injection', 'auth bypass', 'csrf', 'xss', 'ssrf',
               'credential', 'hardcoded', 'github_token', 'access_token', 'api_token',
               'private key', 'exposed secret', 'committed token', 'committed secret',
               'leaked', 'plaintext secret'],
    action: { skill: 'investigate', label: 'Investigate security issue' },
    objectiveTpl: 'Investigate and fix the security issue found in the /health report for {repo}.',
  },
  {
    skills: ['health', 'qa-only'],
    keywords: ['typescript', 'type error', 'ts error', 'tsc error', 'compile error', 'lint', 'eslint', 'unused import'],
    action: { skill: 'ship', label: 'Fix TypeScript & lint errors' },
    objectiveTpl: 'Fix TypeScript and lint errors found in the /health report for {repo}. Focus on type safety and removing unused imports.',
  },
  {
    skills: ['health', 'qa-only'],
    keywords: ['dead code', 'never imported', 'unused export', 'unused function', 'unused variable', 'dead route', 'missing dependency'],
    action: { skill: 'ship', label: 'Remove dead code' },
    objectiveTpl: 'Remove the dead code and unused exports identified in the /health report for {repo}.',
  },
  {
    skills: ['health', 'qa-only'],
    keywords: ['no test', 'missing test', 'untested', 'coverage gap', 'test coverage', 'zero test', '0 test', 'no spec'],
    action: { skill: 'ship', label: 'Add missing tests' },
    objectiveTpl: 'Add unit tests for the untested functions identified in the /health report for {repo}.',
  },
  {
    skills: ['health', 'qa-only'],
    keywords: ['build fail', 'build error', 'compile failed', 'module not found', 'cron bug', 'missing import'],
    action: { skill: 'investigate', label: 'Investigate failing build' },
    objectiveTpl: 'Investigate and fix the build failures found in the /health report for {repo}.',
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
  // ── Phase 57: 5 new skill branches mirroring inferNextSkill in Nexus worker ──
  {
    skills: ['investigate'],
    keywords: ['fix', 'patch', 'should be changed', 'should update', 'race condition', 'memory leak', 'infinite loop'],
    action: { skill: 'ship', label: 'Ship the fix' },
    objectiveTpl: 'Implement the fix identified during investigation of {repo} and open a PR.',
  },
  {
    skills: ['canary'],
    keywords: ['error', 'exception', 'failed', 'timeout'],
    action: { skill: 'investigate', label: 'Investigate canary error' },
    objectiveTpl: 'Investigate the error or failure detected by the canary check for {repo}.',
  },
  {
    skills: ['canary'],
    keywords: ['slow', 'perf', 'latency', 'memory'],
    action: { skill: 'health', label: 'Run health check' },
    objectiveTpl: 'Run a full /health check on {repo} to diagnose the performance issue detected by canary.',
  },
  {
    skills: ['qa'],
    keywords: ['security', 'auth', 'xss', 'injection', 'csrf', 'ssrf'],
    action: { skill: 'investigate', label: 'Investigate security bug' },
    objectiveTpl: 'Investigate the security issue found during QA testing of {repo}.',
  },
  {
    skills: ['qa'],
    keywords: ['bug', 'broken', 'crash', 'regression'],
    action: { skill: 'ship', label: 'Fix QA-reported bugs' },
    objectiveTpl: 'Fix the bugs found during QA testing of {repo} and open a PR.',
  },
  {
    skills: ['ship'],
    keywords: ['deploy', 'production', 'release'],
    action: { skill: 'canary', label: 'Run canary check' },
    objectiveTpl: 'Run a canary check on {repo} to verify the deployment looks healthy.',
  },
  {
    skills: ['ship'],
    keywords: ['test', 'coverage'],
    action: { skill: 'qa-only', label: 'Run QA checks' },
    objectiveTpl: 'Run /qa-only on {repo} to check for regressions introduced by the recent changes.',
  },
  {
    skills: ['document-release'],
    keywords: ['outdated', 'missing', 'incomplete'],
    action: { skill: 'ship', label: 'Complete documentation' },
    objectiveTpl: 'Update the outdated or missing documentation found in {repo} and open a PR.',
  },
]

// Generic fallback — only fires when no specific rule matched.
const GENERIC_RULES: MatchRule[] = [
  {
    skills: ['health', 'qa-only'],
    keywords: ['⚠️', 'error', 'issue', 'warning', 'failed', 'missing', 'bug', 'latent'],
    action: { skill: 'ship', label: 'Fix reported issues' },
    objectiveTpl: 'Fix the issues identified in the /health report for {repo}.',
  },
]

const REPORT_ONLY_SKILLS = new Set(['health', 'qa-only', 'review', 'canary', 'retro'])

/**
 * Returns default actions to always show after a report-only skill, even when
 * no specific rule matched. Gives the user a way to act on any findings.
 */
export function getDefaultActions(
  skillName: string | undefined,
  problemFindings: string[],
  repoName: string,
): SuggestedAction[] {
  if (!skillName || !REPORT_ONLY_SKILLS.has(skillName) || problemFindings.length === 0) return []
  const topFindings = problemFindings.slice(0, 3).join('; ')
  return [
    {
      skill: 'investigate',
      label: 'Deep-dive these findings',
      objective: `Investigate the issues found in the /health report for ${repoName} and fix the most critical ones. Findings: ${topFindings}`,
    },
    {
      skill: 'ship',
      label: 'Fix & ship a PR',
      objective: `Fix the issues identified in the /health report for ${repoName} and open a PR. Address: ${topFindings}`,
    },
  ]
}

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
