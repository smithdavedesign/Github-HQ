/**
 * Phase 55 — CI Feedback Loop unit tests.
 *
 * Tests the pure logic for CI failure detection, retry guards,
 * error summary extraction, and lifecycle stage behaviour.
 * No DB or GitHub API calls — all pure functions.
 */
import { describe, it, expect } from 'vitest'

// ─── Retry guard ──────────────────────────────────────────────────────────────

const MAX_CI_RETRIES = 3

function shouldRetry(attemptCount: number): boolean {
  return attemptCount < MAX_CI_RETRIES
}

function shouldEscalate(attemptCount: number): boolean {
  return attemptCount >= MAX_CI_RETRIES
}

describe('CI retry guard', () => {
  it('retries on attempt 0 (first failure)', () => {
    expect(shouldRetry(0)).toBe(true)
  })

  it('retries on attempt 1', () => {
    expect(shouldRetry(1)).toBe(true)
  })

  it('retries on attempt 2', () => {
    expect(shouldRetry(2)).toBe(true)
  })

  it('escalates to human on attempt 3 (max reached)', () => {
    expect(shouldRetry(3)).toBe(false)
    expect(shouldEscalate(3)).toBe(true)
  })

  it('escalates on any attempt > 3', () => {
    expect(shouldRetry(4)).toBe(false)
    expect(shouldRetry(10)).toBe(false)
  })

  it('MAX_CI_RETRIES is 3', () => {
    expect(MAX_CI_RETRIES).toBe(3)
  })
})

// ─── CI error summary extraction ─────────────────────────────────────────────

interface CheckRun {
  name: string
  conclusion: string | null
  output: {
    title: string | null
    summary: string | null
    text: string | null
  }
  steps?: Array<{ name: string; conclusion: string | null; number: number }>
}

const MAX_ERROR_SUMMARY_LENGTH = 500

function extractErrorSummary(checkRun: CheckRun): string {
  const parts: string[] = []

  if (checkRun.output.title) parts.push(checkRun.output.title)
  if (checkRun.output.summary) parts.push(checkRun.output.summary)

  // Find the first failed step if available
  const failedStep = checkRun.steps?.find(s => s.conclusion === 'failure')
  if (failedStep) parts.push(`Failed step: ${failedStep.name}`)

  const summary = parts.join('\n').slice(0, MAX_ERROR_SUMMARY_LENGTH)
  return summary || `${checkRun.name} failed`
}

describe('extractErrorSummary', () => {
  it('extracts title and summary from check run output', () => {
    const run: CheckRun = {
      name: 'build',
      conclusion: 'failure',
      output: {
        title: 'Build failed',
        summary: 'Module not found: stripe',
        text: null,
      },
    }
    const summary = extractErrorSummary(run)
    expect(summary).toContain('Build failed')
    expect(summary).toContain('Module not found: stripe')
  })

  it('includes failed step name when available', () => {
    const run: CheckRun = {
      name: 'ci',
      conclusion: 'failure',
      output: { title: 'CI failed', summary: null, text: null },
      steps: [
        { name: 'Install dependencies', conclusion: 'success', number: 1 },
        { name: 'Run build', conclusion: 'failure', number: 2 },
        { name: 'Run tests', conclusion: null, number: 3 },
      ],
    }
    const summary = extractErrorSummary(run)
    expect(summary).toContain('Run build')
  })

  it('truncates long summaries to MAX_ERROR_SUMMARY_LENGTH', () => {
    const run: CheckRun = {
      name: 'build',
      conclusion: 'failure',
      output: {
        title: 'Failed',
        summary: 'A'.repeat(1000),
        text: null,
      },
    }
    const summary = extractErrorSummary(run)
    expect(summary.length).toBeLessThanOrEqual(MAX_ERROR_SUMMARY_LENGTH)
  })

  it('falls back to check run name when no output', () => {
    const run: CheckRun = {
      name: 'vercel-build',
      conclusion: 'failure',
      output: { title: null, summary: null, text: null },
    }
    const summary = extractErrorSummary(run)
    expect(summary).toBe('vercel-build failed')
  })
})

// ─── CI lifecycle stages ──────────────────────────────────────────────────────

type AgentLifecycleStage =
  | 'idle' | 'queued' | 'preparing' | 'running'
  | 'pr_ready' | 'ci_failing'
  | 'merged' | 'failed' | 'timed_out' | 'needs_human'

// ci_failing and pr_ready are both BLOCKING — prevent new queue attempts
const BLOCKING_STAGES = new Set<AgentLifecycleStage>([
  'queued', 'preparing', 'running', 'pr_ready', 'ci_failing',
])

const TERMINAL_STAGES = new Set<AgentLifecycleStage>([
  'idle', 'merged', 'failed', 'timed_out', 'needs_human',
])

describe('Phase 55 lifecycle stages', () => {
  it('ci_failing is a blocking stage (prevents re-queue)', () => {
    expect(BLOCKING_STAGES.has('ci_failing')).toBe(true)
  })

  it('needs_human is a terminal stage (allows new queue after human resolves)', () => {
    expect(TERMINAL_STAGES.has('needs_human')).toBe(true)
    expect(BLOCKING_STAGES.has('needs_human')).toBe(false)
  })

  it('pr_ready is still blocking (same as before)', () => {
    expect(BLOCKING_STAGES.has('pr_ready')).toBe(true)
  })

  it('blocking and terminal are mutually exclusive', () => {
    for (const stage of BLOCKING_STAGES) {
      expect(TERMINAL_STAGES.has(stage)).toBe(false)
    }
    for (const stage of TERMINAL_STAGES) {
      expect(BLOCKING_STAGES.has(stage)).toBe(false)
    }
  })

  it('ci_failing → should retry generates a fix task', () => {
    const stage: AgentLifecycleStage = 'ci_failing'
    const attempt = 1
    expect(BLOCKING_STAGES.has(stage)).toBe(true)
    expect(shouldRetry(attempt)).toBe(true)
  })

  it('ci_failing + attempt 3 → escalate to needs_human', () => {
    const stage: AgentLifecycleStage = 'ci_failing'
    const attempt = 3
    expect(BLOCKING_STAGES.has(stage)).toBe(true)
    expect(shouldEscalate(attempt)).toBe(true)
    // After escalation, stage becomes needs_human (terminal)
    const nextStage: AgentLifecycleStage = 'needs_human'
    expect(TERMINAL_STAGES.has(nextStage)).toBe(true)
  })
})

// ─── GitHub check run parsing ─────────────────────────────────────────────────

interface GitHubCheckRunsResponse {
  check_runs: Array<{
    name: string
    status: string
    conclusion: string | null
    html_url: string
    output: { title: string | null; summary: string | null; text: string | null }
  }>
}

function hasFailingCICheck(response: GitHubCheckRunsResponse): boolean {
  return response.check_runs.some(
    run => run.status === 'completed' && run.conclusion === 'failure'
  )
}

function getFailedChecks(response: GitHubCheckRunsResponse) {
  return response.check_runs.filter(
    run => run.status === 'completed' && run.conclusion === 'failure'
  )
}

describe('GitHub check run parsing', () => {
  it('detects a failing check', () => {
    const response: GitHubCheckRunsResponse = {
      check_runs: [
        { name: 'lint', status: 'completed', conclusion: 'success', html_url: '', output: { title: null, summary: null, text: null } },
        { name: 'build', status: 'completed', conclusion: 'failure', html_url: '', output: { title: 'Build failed', summary: 'stripe not found', text: null } },
      ],
    }
    expect(hasFailingCICheck(response)).toBe(true)
    expect(getFailedChecks(response)).toHaveLength(1)
    expect(getFailedChecks(response)[0].name).toBe('build')
  })

  it('returns false when all checks pass', () => {
    const response: GitHubCheckRunsResponse = {
      check_runs: [
        { name: 'lint', status: 'completed', conclusion: 'success', html_url: '', output: { title: null, summary: null, text: null } },
        { name: 'build', status: 'completed', conclusion: 'success', html_url: '', output: { title: null, summary: null, text: null } },
      ],
    }
    expect(hasFailingCICheck(response)).toBe(false)
  })

  it('ignores in-progress checks (not yet completed)', () => {
    const response: GitHubCheckRunsResponse = {
      check_runs: [
        { name: 'build', status: 'in_progress', conclusion: null, html_url: '', output: { title: null, summary: null, text: null } },
      ],
    }
    expect(hasFailingCICheck(response)).toBe(false)
  })

  it('handles multiple failing checks — returns all', () => {
    const response: GitHubCheckRunsResponse = {
      check_runs: [
        { name: 'build', status: 'completed', conclusion: 'failure', html_url: '', output: { title: 'Build failed', summary: null, text: null } },
        { name: 'test', status: 'completed', conclusion: 'failure', html_url: '', output: { title: 'Tests failed', summary: null, text: null } },
      ],
    }
    expect(getFailedChecks(response)).toHaveLength(2)
  })

  it('handles empty check runs array', () => {
    const response: GitHubCheckRunsResponse = { check_runs: [] }
    expect(hasFailingCICheck(response)).toBe(false)
    expect(getFailedChecks(response)).toHaveLength(0)
  })
})

// ─── CI fix objective builder ─────────────────────────────────────────────────

function buildCIFixObjective(
  repoName: string,
  prNumber: number,
  branchName: string,
  errorSummary: string,
  attempt: number,
): string {
  return [
    `Fix CI failure on PR #${prNumber} in ${repoName} (attempt ${attempt + 1}/${MAX_CI_RETRIES})`,
    ``,
    `Branch: ${branchName}`,
    ``,
    `CI Error:`,
    errorSummary.slice(0, 300),
    ``,
    `Instructions:`,
    `- Check out the existing branch (do NOT create a new branch)`,
    `- Read what the previous commit changed`,
    `- Fix the CI failure described above`,
    `- Push a fix commit to the same branch`,
    `- Do not change anything unrelated to the CI failure`,
  ].join('\n')
}

describe('buildCIFixObjective', () => {
  it('includes repo name, PR number, and attempt count', () => {
    const obj = buildCIFixObjective('repohq', 1, 'nexus/auto-abc', 'Module not found: stripe', 0)
    expect(obj).toContain('PR #1')
    expect(obj).toContain('repohq')
    expect(obj).toContain('attempt 1/3')
  })

  it('includes branch name', () => {
    const obj = buildCIFixObjective('myrepo', 5, 'nexus/auto-xyz', 'error', 1)
    expect(obj).toContain('nexus/auto-xyz')
  })

  it('includes the error summary', () => {
    const obj = buildCIFixObjective('repo', 1, 'branch', "Module not found: Can't resolve 'stripe'", 0)
    expect(obj).toContain("stripe")
  })

  it('instructs agent to check out existing branch', () => {
    const obj = buildCIFixObjective('repo', 1, 'branch', 'error', 0)
    expect(obj).toContain('existing branch')
    expect(obj).toContain('do NOT create a new branch')
  })

  it('truncates very long error summaries to 300 chars', () => {
    const longError = 'E'.repeat(1000)
    const obj = buildCIFixObjective('repo', 1, 'branch', longError, 0)
    // The 300-char truncation keeps the objective manageable
    expect(obj.length).toBeLessThan(1000)
  })

  it('shows correct attempt number (1-indexed for humans)', () => {
    const attempt2 = buildCIFixObjective('repo', 1, 'branch', 'err', 1)
    const attempt3 = buildCIFixObjective('repo', 1, 'branch', 'err', 2)
    expect(attempt2).toContain('attempt 2/3')
    expect(attempt3).toContain('attempt 3/3')
  })
})

// ─── PR URL → owner/repo/number parser ───────────────────────────────────────

function parsePRUrl(prUrl: string): { owner: string; repo: string; number: number } | null {
  const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
  if (!match) return null
  return { owner: match[1], repo: match[2], number: parseInt(match[3], 10) }
}

describe('parsePRUrl', () => {
  it('parses a standard GitHub PR URL', () => {
    const result = parsePRUrl('https://github.com/smithdavedesign/Github-HQ/pull/1')
    expect(result).toEqual({ owner: 'smithdavedesign', repo: 'Github-HQ', number: 1 })
  })

  it('parses PR with large number', () => {
    const result = parsePRUrl('https://github.com/org/repo/pull/1234')
    expect(result?.number).toBe(1234)
  })

  it('returns null for non-PR URLs', () => {
    expect(parsePRUrl('https://github.com/org/repo')).toBeNull()
    expect(parsePRUrl('https://example.com/pull/1')).toBeNull()
    expect(parsePRUrl('')).toBeNull()
  })
})
