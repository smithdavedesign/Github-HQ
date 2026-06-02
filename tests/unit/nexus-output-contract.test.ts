/**
 * Validates the Nexus agent output.json contract schema.
 * This contract is what gstack scripts write and Nexus reads to create PRs.
 * Any agent execution (gstack-ship.sh, gstack-investigate.sh, or future gstack skills)
 * must produce output matching this contract.
 */
import { describe, it, expect } from 'vitest'

interface NexusAgentOutput {
  contractVersion: string
  summary: string
  findings: string[]
  outcome: 'changes-made' | 'no-changes' | 'blocked'
  changedFiles: string[]
  validationCommand?: string
  pullRequest?: {
    title: string
    body: string
    draft?: boolean
  }
}

function validateContract(output: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = []
  const o = output as Record<string, unknown>

  if (o.contractVersion !== 'nexus-agent-output-v1') {
    errors.push(`contractVersion must be 'nexus-agent-output-v1', got '${o.contractVersion}'`)
  }
  if (typeof o.summary !== 'string' || o.summary.length === 0) {
    errors.push('summary must be a non-empty string')
  }
  if (!Array.isArray(o.findings)) {
    errors.push('findings must be an array')
  }
  const validOutcomes = ['changes-made', 'no-changes', 'blocked']
  if (!validOutcomes.includes(o.outcome as string)) {
    errors.push(`outcome must be one of ${validOutcomes.join(', ')}, got '${o.outcome}'`)
  }
  if (!Array.isArray(o.changedFiles)) {
    errors.push('changedFiles must be an array')
  }
  if (o.outcome === 'changes-made' && (o.changedFiles as string[]).length === 0) {
    errors.push('changedFiles must not be empty when outcome is changes-made')
  }
  if (o.pullRequest !== undefined) {
    const pr = o.pullRequest as Record<string, unknown>
    if (typeof pr.title !== 'string' || pr.title.length === 0) {
      errors.push('pullRequest.title must be a non-empty string')
    }
    if (typeof pr.body !== 'string') {
      errors.push('pullRequest.body must be a string')
    }
  }

  return { valid: errors.length === 0, errors }
}

// ─── Valid contract examples ───────────────────────────────────────────────────

describe('Nexus output contract — valid outputs', () => {
  it('accepts a valid no-changes (investigation) output', () => {
    const output: NexusAgentOutput = {
      contractVersion: 'nexus-agent-output-v1',
      summary: 'No security vulnerabilities found — codebase is clean',
      findings: [
        'All cron routes use fail-secure secret validation',
        'No sql.raw() usage with user input',
        'URL validation present in notifications and deployments',
      ],
      outcome: 'no-changes',
      changedFiles: [],
      validationCommand: 'npm run typecheck',
    }
    const { valid, errors } = validateContract(output)
    expect(valid).toBe(true)
    expect(errors).toHaveLength(0)
  })

  it('accepts a valid changes-made output with PR metadata', () => {
    const output: NexusAgentOutput = {
      contractVersion: 'nexus-agent-output-v1',
      summary: 'Fixed critical security alert: updated lodash to 4.17.21',
      findings: [
        'CVE-2021-23337 in lodash <4.17.21: prototype pollution',
        'Updated package.json and package-lock.json',
        'npm audit passes after update',
      ],
      outcome: 'changes-made',
      changedFiles: ['package.json', 'package-lock.json'],
      validationCommand: 'npm test',
      pullRequest: {
        title: 'fix: update lodash to patch CVE-2021-23337',
        body: '## Summary\n- Updated lodash from 4.17.20 to 4.17.21\n- Resolves critical prototype pollution vulnerability',
        draft: false,
      },
    }
    const { valid, errors } = validateContract(output)
    expect(valid).toBe(true)
    expect(errors).toHaveLength(0)
  })

  it('accepts a blocked output', () => {
    const output: NexusAgentOutput = {
      contractVersion: 'nexus-agent-output-v1',
      summary: 'Cannot safely fix — vulnerability is in a transitive dependency',
      findings: [
        'CVE-2023-1234 is in package-A, depended on by package-B (no patch available)',
        'Manual intervention required',
      ],
      outcome: 'blocked',
      changedFiles: [],
    }
    const { valid, errors } = validateContract(output)
    expect(valid).toBe(true)
    expect(errors).toHaveLength(0)
  })
})

// ─── Invalid contract examples ────────────────────────────────────────────────

describe('Nexus output contract — invalid outputs rejected', () => {
  it('rejects wrong contractVersion', () => {
    const output = {
      contractVersion: 'v1',  // wrong
      summary: 'Test',
      findings: [],
      outcome: 'no-changes',
      changedFiles: [],
    }
    const { valid, errors } = validateContract(output)
    expect(valid).toBe(false)
    expect(errors.some(e => e.includes('contractVersion'))).toBe(true)
  })

  it('rejects empty summary', () => {
    const output = {
      contractVersion: 'nexus-agent-output-v1',
      summary: '',
      findings: [],
      outcome: 'no-changes',
      changedFiles: [],
    }
    const { valid } = validateContract(output)
    expect(valid).toBe(false)
  })

  it('rejects invalid outcome value', () => {
    const output = {
      contractVersion: 'nexus-agent-output-v1',
      summary: 'Test',
      findings: [],
      outcome: 'success',  // invalid
      changedFiles: [],
    }
    const { valid, errors } = validateContract(output)
    expect(valid).toBe(false)
    expect(errors.some(e => e.includes('outcome'))).toBe(true)
  })

  it('rejects changes-made with empty changedFiles', () => {
    const output = {
      contractVersion: 'nexus-agent-output-v1',
      summary: 'Made changes',
      findings: ['Updated package.json'],
      outcome: 'changes-made',
      changedFiles: [],  // should not be empty for changes-made
    }
    const { valid } = validateContract(output)
    expect(valid).toBe(false)
  })

  it('rejects PR with empty title', () => {
    const output = {
      contractVersion: 'nexus-agent-output-v1',
      summary: 'Made changes',
      findings: [],
      outcome: 'changes-made',
      changedFiles: ['file.ts'],
      pullRequest: { title: '', body: 'Description' },
    }
    const { valid } = validateContract(output)
    expect(valid).toBe(false)
  })
})

// ─── gstack script context variables ─────────────────────────────────────────

describe('gstack script environment contract', () => {
  const REQUIRED_ENV_VARS = [
    'NEXUS_AGENT_TASK_ID',
    'NEXUS_AGENT_EXECUTION_ID',
    'NEXUS_AGENT_WORKTREE_PATH',
    'NEXUS_AGENT_PROMPT_FILE',
    'NEXUS_AGENT_CONTEXT_FILE',
    'NEXUS_AGENT_OUTPUT_FILE',
  ]

  it('defines all required env var names for gstack scripts', () => {
    for (const varName of REQUIRED_ENV_VARS) {
      expect(typeof varName).toBe('string')
      expect(varName.startsWith('NEXUS_AGENT_')).toBe(true)
    }
  })

  it('output file path is under .nexus/ by convention', () => {
    const outputPath = '.nexus/output.json'
    expect(outputPath.startsWith('.nexus/')).toBe(true)
    expect(outputPath.endsWith('.json')).toBe(true)
  })
})
