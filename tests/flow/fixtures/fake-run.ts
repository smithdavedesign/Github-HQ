/**
 * Stand-in for factory/run.ts, report.ts and scout.ts under the worker in the flow tests
 * (FACTORY_WORKER_CHILD=tests/flow/fixtures/fake-run.ts). The real pipeline needs Docker, LiteLLM
 * and GitHub; this keeps everything around it real: the worker spawns it as a child process, it
 * speaks the same ::trace:: / ::result:: protocol, and it writes Neon through the factory's own
 * code (Tracer, resolveRequest, recordAttempt) exactly where run.ts does.
 *
 *   npx tsx tests/flow/fixtures/fake-run.ts <job> [--scheduled] [--request=<id>]
 *
 * A request's objective picks the outcome with a marker, e.g. "Check health [flow:report]":
 *   report      reported, with a findings report           (report requests default to this)
 *   pr          a judged fix opened a PR                    (fix requests default to this)
 *   verified    a judged fix held at stage `report` (no PR)
 *   rejected    the judge rejected the change
 *   defer       deferred (LiteLLM down): back in the queue, not a failure
 *   defer-once  deferred on the first pickup, reported on the next
 *   fail        the run failed (counts towards the retry limit)
 *   crash       exits 3 without a result line
 *   slow        sleeps until it is killed (shutdown and heartbeat tests)
 */
import { randomUUID } from 'node:crypto'
import { loadConfig } from '../../../factory/lib/config'
import type { AttemptEntry } from '../../../factory/lib/ledger'
import { loadRequest, resolveRequest, resolvedFromRow } from '../../../factory/lib/agent-requests'
import type { OwnerOutcome } from '../../../factory/lib/owner-requests'
import { recordAttempt } from '../../../factory/lib/sink'
import { RESULT_PREFIX, Tracer, formatProtocolLine, type RunResult } from '../../../factory/lib/trace'
import { FLOW_DEFER_REASON, FLOW_FAIL_REASON, FLOW_FINDINGS, FLOW_PR_URL, scenarioOf } from '../harness/scenarios'

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** run.ts's ledger run id: stored on the request (agent_requests.run_id) and its events. */
const ledgerRunId = `flow-${Date.now()}`

function attempt(repo: string, requestId: string, outcome: AttemptEntry['outcome'], extra: Partial<AttemptEntry> = {}): AttemptEntry {
  return {
    type: 'attempt', id: `flow-${randomUUID()}`, runId: ledgerRunId, at: new Date().toISOString(), repo, kind: 'owner-requested',
    taskTier: 2, tier: 'M1', model: 'free-agent', harness: 'claude-code', outcome, reason: outcome === 'verified' ? 'checks pass' : 'judge: a check regressed',
    exploring: false, durationMs: 1_200, costUsd: 0, inputTokens: 1_000, outputTokens: 200, isolation: 'docker', requests: 3,
    ownerTaskId: requestId, ...extra,
  }
}


async function runRequest(tracer: Tracer, requestId: string): Promise<RunResult> {
  const cfg = loadConfig()
  const row = await loadRequest(cfg, requestId)
  if (!row) return { status: 'failed', reason: `request ${requestId} not found` }
  const scenario = scenarioOf(row.objective, row.mode, row.attempts)
  tracer.step('request', 'info', `${row.mode} request on ${row.repo}${row.skill ? ` (/${row.skill})` : ''}`, { source: row.source, attempt: row.attempts, scenario })

  if (scenario === 'crash') process.exit(3)
  if (scenario === 'slow') {
    tracer.step('clone', 'start')
    await sleep(10 * 60_000)
  }
  await tracer.span('clone', () => sleep(20))
  await tracer.span('install', () => sleep(20))
  await tracer.span('checks', () => sleep(20), () => ({ detail: 'typecheck · lint · test' }))

  if (scenario === 'defer') {
    tracer.step('preflight', 'fail', 'LiteLLM gateway is down')
    return { status: 'deferred', reason: FLOW_DEFER_REASON, retryInMinutes: 30 }
  }
  if (scenario === 'fail') {
    tracer.step('attempt', 'fail', 'the harness crashed')
    return { status: 'failed', reason: FLOW_FAIL_REASON }
  }

  const resolved = resolvedFromRow(row)
  let outcome: OwnerOutcome
  if (scenario === 'report') {
    await tracer.span('report', () => sleep(20), () => ({ detail: '2 findings' }))
    outcome = { status: 'reported', findings: FLOW_FINDINGS }
  } else {
    const verified = scenario !== 'rejected'
    const a = attempt(row.repo, row.id, verified ? 'verified' : 'failed', scenario === 'pr' ? { prUrl: FLOW_PR_URL } : verified ? { reported: true } : {})
    await tracer.span('attempt', () => recordAttempt(cfg, a, row.objective), () => ({ detail: `${a.tier} ${a.model}` }), a.id)
    await tracer.span('judge', () => sleep(20), () => ({ status: verified ? 'ok' : 'fail', detail: verified ? 'rules pass' : a.reason }), a.id)
    if (scenario === 'pr') {
      await tracer.span('pr', () => sleep(20), () => ({ detail: FLOW_PR_URL }), a.id)
      outcome = { status: 'pr', prUrl: FLOW_PR_URL }
    } else if (verified) {
      tracer.step('held', 'info', "owner-requested is at stage 'report'", undefined, { jobId: a.id })
      outcome = { status: 'verified', reason: "verified, held — owner-requested is at stage 'report' (or a dry run); promote it to 'pr' to open the PR" }
    } else {
      outcome = { status: 'rejected', reason: a.reason }
    }
  }
  await resolveRequest(cfg, resolved, outcome, ledgerRunId, new Date())
  tracer.step('request', outcome.status === 'rejected' ? 'fail' : 'ok', outcome.status)
  return { status: 'ok', summary: { prs: outcome.status === 'pr' ? 1 : 0 } }
}

async function main(): Promise<RunResult> {
  const [job, ...rest] = process.argv.slice(2)
  const requestId = rest.find(a => a.startsWith('--request='))?.slice('--request='.length) || null
  const tracer = new Tracer(loadConfig(), process.env.FACTORY_AUTOMATION_RUN_ID || null, requestId)
  try {
    if (job === 'request' && requestId) return await runRequest(tracer, requestId)
    await tracer.span(job ?? 'run', () => sleep(30), () => ({ detail: `flow ${job}` }))
    return { status: 'ok', summary: { flow: true, job } }
  } finally {
    await tracer.flush()
  }
}

main().then(
  result => console.log(formatProtocolLine(RESULT_PREFIX, result)),
  err => {
    console.log(formatProtocolLine(RESULT_PREFIX, { status: 'failed', reason: err instanceof Error ? err.message : String(err) }))
    process.exitCode = 1
  },
)
