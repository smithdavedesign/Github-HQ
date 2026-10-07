/**
 * What the flow tests' stand-in executor (tests/flow/fixtures/fake-run.ts) produces, shared with
 * the tests that assert on it. A request's objective picks the outcome with a `[flow:<scenario>]`
 * marker; see fake-run.ts for what each one does.
 */
export type FlowScenario = 'report' | 'pr' | 'verified' | 'rejected' | 'defer' | 'defer-once' | 'fail' | 'crash' | 'slow'

export const FLOW_FINDINGS = [
  '## Summary',
  'Two problems, one of them a real bug.',
  '',
  '## Findings',
  '- src/lib/db/index.ts:12 — the connection is created on every call',
  '- README.md: the setup section names a script that no longer exists',
  '',
  '## Suggested next step',
  'Queue /ship for the first finding.',
].join('\n')

/** The findings list RepoHQ parses out of FLOW_FINDINGS (findingsFromReport). */
export const FLOW_FINDING_LINES = [
  'src/lib/db/index.ts:12 — the connection is created on every call',
  'README.md: the setup section names a script that no longer exists',
]

export const FLOW_PR_URL = 'https://github.com/flow-owner/flow-repo/pull/81'

/** The reason a deferred run reports (the worker writes it on the request row). */
export const FLOW_DEFER_REASON = 'LiteLLM gateway is down (see ~/ai-stack/README.md troubleshooting)'

export const FLOW_FAIL_REASON = 'the harness crashed (flow)'

export function objective(text: string, scenario?: FlowScenario): string {
  return scenario ? `${text} [flow:${scenario}]` : text
}

export function scenarioOf(objectiveText: string, mode: string, attempts: number): FlowScenario {
  const marked = /\[flow:([a-z-]+)\]/.exec(objectiveText)?.[1] as FlowScenario | undefined
  const s = marked ?? (mode === 'report' ? 'report' : 'pr')
  if (s === 'defer-once') return attempts <= 1 ? 'defer' : 'report'
  return s
}
