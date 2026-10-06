/**
 * RepoHQ autonomous factory — one improvement cycle (docs/autonomous-factory.md).
 *
 *   npx tsx factory/run.ts                 # reconcile PRs, scan repos, fix one thing, open a draft PR
 *   npx tsx factory/run.ts --dry-run       # everything except push + PR
 *   npx tsx factory/run.ts --repo=owner/name --max-repos=3
 *   npx tsx factory/run.ts --report        # print the per-tier ledger summary and exit
 *
 * Sense (repo's own checks) → Decide (task) → Route (model-router) → Execute
 * (Aider / Claude Code via LiteLLM) → Verify (judge) → Gate (draft PR) →
 * Learn (PR merged/closed → ledger → router).
 */
import { existsSync, mkdirSync, rmSync, statSync, writeFileSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  allowedTiers, canUsePaidTier, chooseTier, classifyRepoData, computeTierStats, nextTier, type ModelTier,
} from '../src/lib/agents/model-router'
import { loadConfig, type FactoryConfig } from './lib/config'
import { collectPackageInfo, confirmFailures, detectPackageManager, installCommand, lintProblems, lintScriptAutofixes, planChecks, readRepoBasics, readmeIssue, runAudit, runChecks, type AuditCounts, type CheckResult, type CheckSpec } from './lib/checks'
import { addPrLabel, applyPatchAndCommit, listFiles, patchText, checkoutNewBranch, cloneRepo, checkoutIntegrationBranch, commitAll, createDraftPr, currentBranch, diffAgainst, diffInfo, headSha, prState, pushBranch, repoVisibility, resetWorktree, squashOnto } from './lib/git'
import { copilotReview, requestCopilotReview } from './lib/copilot-review'
import { copilotHasQuota, copilotQuota } from './lib/copilot-quota'
import { harnessFor, runHarness, type HarnessResult } from './lib/harness'
import { appendEntry, deadEnds, latestSignals, monthToDateUsd, openPrAttempts, pendingCiOracles, pendingReviews, readLedger, summarizeByTier, toAttemptRecords, todaysUsage, type AttemptEntry, type SignalsEntry } from './lib/ledger'
import { listAliases } from './lib/litellm-ops'
import { branchName, commitMessage, prBody, prTitle } from './lib/pr'

import { run, type Runner } from './lib/proc'
import { Sandbox, dockerAvailable, ensureSandboxImages, sandboxModels, sweepSandboxes } from './lib/sandbox'
import { healthScores, recordApprovalNeeded, recordAttempt, recordResolution } from './lib/sink'
import { failedLog, rankOpportunities, senseRepo } from './lib/sensors'
import { acquireLock } from './lib/lock'
import { nightShiftReadiness, readinessLine, scheduledPolicy } from './lib/night-shift'
import { freeQuota, m1Deferred } from './lib/quota'
import { readManagedModels } from './lib/litellm-config'
import { buildPrompt, filterTasks, fitLocalContext, investigationPrompt, isEnvironmentFailure, ownerRequestedTask, parseFindings, redCiTask, tasksFromScan, type FactoryTask } from './lib/tasks'
import { pendingOwnerRequests, recordOwnerBlocked, recordOwnerResult, type OwnerRequest } from './lib/owner-requests'
import { judge, type DiffInfo, type Verdict } from './lib/verify'
import { NEEDS_REVIEW_LABEL, adversaryAction, adversarySection, runAdversary, type AdversaryResult } from './lib/adversary'
import { trimCheck, type JudgeInputRecord } from './lib/judge-fixture'

interface Args { dryRun: boolean; repo: string | null; maxRepos: number; report: boolean; keep: boolean; scheduled: boolean }

function parseArgs(argv: string[]): Args {
  const val = (k: string) => argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? null
  return {
    dryRun: argv.includes('--dry-run'),
    repo: val('repo'),
    maxRepos: Number(val('max-repos') ?? 3),
    report: argv.includes('--report'),
    keep: argv.includes('--keep'),
    // Set by the launchd wrapper (factory.sh): the night shift's policy applies.
    scheduled: argv.includes('--scheduled'),
  }
}

const runId = `${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12)}-${randomUUID().slice(0, 4)}`
let logDir = ''
let copilotInstalled = false
let copilotQuotaLeft = true
/** Id of the most recent attempt written (parent of the next tier's attempt on escalation). */
let lastAttemptId: string | null = null
/** Built sandbox image tags; null when cfg.sandbox.mode is 'off'. */
let sandboxImages: { worker: string; egress: string } | null = null
const log = (...a: unknown[]) => console.log(`[factory ${new Date().toISOString().slice(11, 19)}]`, ...a)

async function main() {
  const args = parseArgs(process.argv.slice(2))
  let cfg = loadConfig()
  mkdirSync(cfg.home, { recursive: true })
  logDir = path.join(cfg.home, 'logs', runId)

  if (args.report) return printReport(cfg)
  if (existsSync(path.join(cfg.home, 'PAUSE'))) return log(`paused (${path.join(cfg.home, 'PAUSE')} exists) — nothing to do`)
  if (cfg.repos.length === 0 && !args.repo) throw new Error('no repos in factory.config.json allowlist')
  if (args.repo && !cfg.repos.includes(args.repo)) throw new Error(`${args.repo} is not in the allowlist`)

  if (args.scheduled) {
    // Night Shift v2 (Phase 80): unattended cycles are always sandboxed and always $0.
    const policy = scheduledPolicy(cfg)
    if (policy.refuse) return log(`scheduled cycle refused — ${policy.refuse}`)
    for (const n of policy.notes) log(n)
    cfg = policy.cfg
  }

  acquireLock(cfg.home, `run ${runId}`)
  mkdirSync(logDir, { recursive: true })
  log(`run ${runId}${args.dryRun ? ' (dry run)' : ''}`)

  copilotInstalled = (await run('copilot', ['--version'], { timeoutMs: 30_000 })).code === 0
  const quota = copilotInstalled ? await copilotQuota() : null
  copilotQuotaLeft = copilotHasQuota(quota)
  if (!copilotQuotaLeft) log(`Copilot premium requests used up (resets ${quota?.resetDate ?? 'next month'}) — Copilot builder and reviews paused`)
  await reconcile(cfg)

  const aliases = await listAliases(cfg).catch((): string[] => [])
  for (const t of ['M0', 'M1'] as const) {
    if (!aliases.includes(cfg.models[t])) log(`warning: LiteLLM alias ${cfg.models[t]} (${t}) not available`)
  }
  if (aliases.length === 0) throw new Error('LiteLLM gateway is down — see ~/ai-stack/README.md troubleshooting')

  if (cfg.sandbox.mode === 'docker') {
    // Repo code (install, checks, the model harness) only runs in the sandbox. No Docker → no
    // cycle: never fall back to running untrusted code on the host (roadmap Phase 76).
    if (!(await dockerAvailable())) {
      log('Docker is not running — skipping this cycle (repo code never runs on the host; start Docker Desktop, or see factory/README.md "Sandbox")')
      return
    }
    const swept = await sweepSandboxes(cfg.home)
    if (swept > 0) log(`removed ${swept} sandbox container(s) left by an earlier run`)
    sandboxImages = await ensureSandboxImages(cfg.sandbox, m => log(m))
    log(`sandbox: ${sandboxImages.worker}`)
  } else {
    log('sandbox OFF — repo code runs on the host (trusted fixtures only)')
  }

  // Sense (Phase 78): red CI, security alerts and stale bot PRs for every candidate repo, then
  // one ranked queue across repos (red CI > security > failing checks > docs, weighted by health).
  const sensed: SignalsEntry[] = []
  for (const repo of args.repo ? [args.repo] : cfg.repos) {
    const sig = await senseRepo(repo, cfg.integrationBranch, runId, new Date())
    appendEntry(cfg.home, sig)
    sensed.push(sig)
  }
  const ranked = rankOpportunities(args.repo ? [args.repo] : cfg.repos, readLedger(cfg.home), sensed, new Date(), {
    health: await healthScores(cfg), blockOnStalePrs: cfg.blockOnStaleBotPrs,
  })
  for (const o of ranked.filter(x => x.blocked)) log(`${o.repo}: no new PRs — ${o.blocked} (review or close them)`)
  log(`queue: ${ranked.filter(x => !x.blocked).slice(0, 5).map(o => `${o.repo.split('/')[1]}(${o.score}${o.reasons.length ? `: ${o.reasons[0]}` : ''})`).join(' · ')}`)
  const queue = ranked.filter(x => !x.blocked).map(x => x.repo).slice(0, args.repo ? 1 : args.maxRepos)
  let prs = 0
  const openedToday = todaysUsage(readLedger(cfg.home), new Date()).prs
  if (openedToday >= cfg.maxPrsPerDay) {
    log(`daily PR cap reached (${openedToday}/${cfg.maxPrsPerDay}) — reconcile only`)
    return printReport(cfg)
  }
  // Front door (ai-stack/repohq/CONTRACT.md): owner requests are explicit human intent, so their
  // repos jump the sensed queue (deduped, respecting --repo). One owner task per repo per cycle.
  const ownerReqs = pendingOwnerRequests(cfg.home, readLedger(cfg.home))
    .filter(r => !args.repo || r.repo === args.repo)
  if (ownerReqs.length > 0) log(`owner requests: ${ownerReqs.map(r => `${r.repo.split('/')[1]}(${r.taskId})`).join(' · ')}`)
  const fullQueue = [...new Set([...ownerReqs.map(r => r.repo), ...queue])]
  for (const repo of fullQueue) {
    if (prs >= cfg.maxPrsPerCycle || openedToday + prs >= cfg.maxPrsPerDay) break
    try {
      prs += await improveRepo(cfg, repo, args, aliases, sensed.find(x => x.repo === repo) ?? null, ownerReqs.find(r => r.repo === repo) ?? null)
    } catch (err) {
      log(`${repo}: ${err instanceof Error ? err.message : err}`)
    }
  }
  log(`done — ${prs} PR(s) opened`)
  printReport(cfg)
}

async function humanCommitsOn(prUrl: string): Promise<number | null> {
  const r = await run('gh', ['pr', 'view', prUrl, '--json', 'commits', '--jq', '.commits | length'], { timeoutMs: 60_000 })
  const n = Number(r.output.trim())
  return r.code === 0 && Number.isFinite(n) && n > 0 ? n - 1 : null
}

/** Learn step: merged/closed factory PRs become resolutions the router reads; Copilot reviews are recorded. */
async function reconcile(cfg: FactoryConfig) {
  for (const a of pendingReviews(readLedger(cfg.home))) {
    const r = await copilotReview(a.prUrl!)
    if (r.reviewed) {
      appendEntry(cfg.home, { type: 'review', attemptId: a.id, at: new Date().toISOString(), reviewer: 'copilot', comments: r.comments, highlights: r.highlights })
      log(`Copilot reviewed ${a.prUrl}: ${r.comments} comment(s)`)
    }
  }
  const open = openPrAttempts(readLedger(cfg.home))
  for (const a of open) {
    const state = await prState(a.prUrl!)
    if (state === 'MERGED' || state === 'CLOSED') {
      const outcome = state === 'MERGED' ? 'merged' : 'rejected'
      // The factory pushes exactly one commit; anything more is a human edit (review-load proxy, Phase 79).
      const humanCommits = await humanCommitsOn(a.prUrl!)
      appendEntry(cfg.home, { type: 'resolution', attemptId: a.id, at: new Date().toISOString(), outcome, ...(humanCommits !== null ? { humanCommits } : {}) })
      await recordResolution(cfg, a.id, outcome, humanCommits)
      log(`reconciled ${a.prUrl} → ${state.toLowerCase()}`)
    }
  }
  // red-ci oracle: the workflow that was failing on the base branch must pass on the PR.
  for (const a of pendingCiOracles(readLedger(cfg.home))) {
    const workflow = a.ciWorkflow
    if (!workflow) continue
    const r = await run('gh', ['pr', 'checks', a.prUrl!, '--json', 'workflow,bucket'], { timeoutMs: 60_000 })
    let checks: { workflow: string; bucket: string }[] = []
    try { checks = JSON.parse(r.output) } catch { continue }
    const mine = checks.filter(c => c.workflow === workflow)
    if (mine.length === 0 || mine.some(c => c.bucket === 'pending')) continue
    const passed = mine.every(c => c.bucket === 'pass' || c.bucket === 'skipping')
    appendEntry(cfg.home, { type: 'ci_oracle', attemptId: a.id, at: new Date().toISOString(), workflow, passed })
    log(`red-ci oracle ${a.prUrl}: "${workflow}" ${passed ? 'passes' : 'still fails'} on the PR`)
  }
}

/** Returns the number of PRs opened (0 or 1). */
async function improveRepo(cfg: FactoryConfig, repo: string, args: Args, aliases: string[], signals: SignalsEntry | null, ownerReq: OwnerRequest | null = null): Promise<number> {
  const dir = path.join(cfg.home, 'work', runId, repo.replace('/', '__'))
  log(`${repo}: cloning`)
  await cloneRepo(repo, dir)
  let sandbox: Sandbox | null = null
  try {
    const integration = await checkoutIntegrationBranch(dir, cfg.integrationBranch)
    const base = integration ? cfg.integrationBranch : await currentBranch(dir)
    if (integration) log(`${repo}: targeting ${cfg.integrationBranch} (repo's integration branch)`)
    // Static reads of the fresh clone are fine on the host; nothing from the repo has run yet.
    const basics = readRepoBasics(dir)
    if (sandboxImages) {
      sandbox = await Sandbox.open({
        cfg: cfg.sandbox, litellmUrl: cfg.litellm.url, scope: cfg.home, images: sandboxImages,
        allowModels: sandboxModels(cfg.models, { paidBudgetUsd: cfg.monthlyBudgetUsd, extra: ['local-small'] }),
      })
      await sandbox.copyIn(dir)
    }
    const ws: Workspace = sandbox ? { dir: sandbox.dir, run: sandbox.run, sandbox } : { dir, run, sandbox: null }
    let specs: CheckSpec[] = []
    let baseline: CheckResult[] = []
    let audit: AuditCounts | null = null

    if (basics.pkg && !basics.pkg.workspaces) {
      const pm = detectPackageManager(basics.files)
      const install = installCommand(pm, basics.files)
      log(`${repo}: ${install.cmd} ${install.args.join(' ')}`)
      let ins = await ws.run(install.cmd, install.args, { cwd: ws.dir, timeoutMs: cfg.checkTimeoutMs })
      if (ins.code !== 0 && /ETIMEDOUT|ECONNRESET|EAI_AGAIN|network/i.test(ins.output)) {
        log(`${repo}: install hit a network error — retrying once`)
        ins = await ws.run(install.cmd, install.args, { cwd: ws.dir, timeoutMs: cfg.checkTimeoutMs })
      }
      if (ins.code !== 0) {
        writeFileSync(path.join(logDir, `${slug(repo)}-install.log`), ins.output)
        appendEntry(cfg.home, { type: 'scan', runId, at: new Date().toISOString(), repo, checks: { install: false }, tasks: [] })
        log(`${repo}: install failed — skipping (log in ${logDir})`)
        return 0
      }
      specs = planChecks(basics.pkg, pm, basics.hasTsconfig)
      baseline = await runChecks(specs, ws.dir, cfg.checkTimeoutMs, ws.run)
      for (const b of baseline) writeFileSync(path.join(logDir, `${slug(repo)}-baseline-${b.name}.log`), b.output)
      if (baseline.some(b => !b.ok)) {
        const confirmed = await confirmFailures(specs, baseline, ws.dir, cfg.checkTimeoutMs, ws.run)
        if (confirmed.flaky.length > 0) log(`${repo}: ${confirmed.flaky.join(', ')} failed once then passed — treated as flaky, not a task`)
        baseline = confirmed.results
      }
      // Some repos' checks write files (e.g. `eslint . --fix`). Start every attempt from a clean tree.
      const sideEffects = await diffInfo(ws.dir, ws.run)
      if (sideEffects.files.length > 0) {
        log(`${repo}: checks modified ${sideEffects.files.length} tracked file(s) (auto-fixing lint/format script) — discarded`)
        await resetWorktree(ws.dir, ws.run)
      }
      if (pm === 'npm' && basics.files.has('package-lock.json')) audit = await runAudit(ws.dir, undefined, ws.run)
    }

    const ledger = readLedger(cfg.home)
    const now = new Date()
    const openKinds = new Set(openPrAttempts(ledger).map(a => `${a.repo}:${a.kind}`))
    // Root for relativising paths in check output (absolute /workspace/… paths inside the sandbox).
    const allTasks = tasksFromScan(baseline, specs, readmeIssue(basics.readme), ws.dir, audit, { lintAutofixes: lintScriptAutofixes(basics.pkg) })
    // Red CI on the base branch comes first (highest value); its log is read on the host via gh.
    const red = signals?.base === base ? signals.redCi?.[0] : undefined
    if (red && cfg.capabilities['red-ci'] !== 'observe') allTasks.unshift(redCiTask(red, base, await failedLog(repo, red.runId)))
    else if (red) allTasks.unshift(redCiTask(red, base, ''))
    // Owner request goes to the very front — explicit human intent outranks sensed work.
    if (ownerReq) allTasks.unshift(ownerRequestedTask(repo, ownerReq.task, ownerReq.taskId))
    const tasks = filterTasks(allTasks, repo, openKinds, deadEnds(ledger, now))
    // If the owner task was filtered (an owner-requested PR is already open, or it's a dead end),
    // close the loop so the front door reports it instead of re-queuing it every cycle.
    if (ownerReq && !tasks.some(t => t.ownerTaskId === ownerReq.taskId)) {
      recordOwnerBlocked(cfg.home, { ownerTaskId: ownerReq.taskId, repo, runId, now,
        reason: openKinds.has(`${repo}:owner-requested`) ? 'an owner-requested PR is already open for this repo — review or close it first' : 'blocked as a dead end (repeated failures) — try a more specific request' })
    }
    appendEntry(cfg.home, {
      type: 'scan', runId, at: now.toISOString(), repo,
      checks: Object.fromEntries(baseline.map(b => [b.name, b.ok])),
      tasks: allTasks.map(t => t.kind),
      audit,
      envFailures: baseline.filter(b => !b.ok && isEnvironmentFailure(b.output)).map(b => b.name),
    })
    log(`${repo}: checks ${baseline.map(b => `${b.name}=${b.ok ? 'ok' : 'FAIL'}`).join(' ') || '(none)'}; tasks: ${tasks.map(t => t.kind).join(', ') || 'none'}${allTasks.length > tasks.length ? ` (${allTasks.length - tasks.length} skipped: open PR or dead end)` : ''}`)

    const sizeOf = (f: string) => { try { return statSync(path.join(dir, f)).size } catch { return 0 } }
    const visibility = await repoVisibility(repo)
    const dataClass = classifyRepoData({ visibility })
    const ctx: TaskContext = { cfg, repo, dir, ws, base, pkg: basics.pkg, specs, baseline, args, aliases, dataClass, audit }

    // Try at most two tasks per repo: when free cloud quota defers the first,
    // local (M0) work on the next task still gets done this cycle.
    // Promotion ladder (Phase 75): `observe` capabilities are sensed and logged, never attempted.
    const observed = tasks.filter(t => cfg.capabilities[t.kind] === 'observe')
    if (observed.length > 0) log(`${repo}: observe-only: ${observed.map(t => t.kind).join(', ')} (capability stage)`)
    const runnable = tasks.filter(t => cfg.capabilities[t.kind] !== 'observe')
    for (const t of runnable.slice(0, 2)) {
      const result = await runLadder(ctx, fitLocalContext(t, sizeOf), ledger, now)
      // Front door: record the terminal result so OpenClaw's `report` can deliver it (skips on 'deferred').
      if (t.kind === 'owner-requested' && t.ownerTaskId) {
        recordOwnerResult(cfg.home, { ownerTaskId: t.ownerTaskId, repo, runId, result, ledger: readLedger(cfg.home), now })
      }
      if (result === 'pr') return 1
      if (result === 'verified' || result === 'stop') return 0
      // 'reported' (an investigation) / 'deferred' / 'failed': try the next task.
    }
    return 0
  } finally {
    await sandbox?.close()
    if (!args.keep) rmSync(dir, { recursive: true, force: true })
  }
}

/** Where repo code runs: the sandbox's copy of the clone, or (sandbox off) the host clone itself. */
interface Workspace {
  dir: string
  run: Runner
  sandbox: Sandbox | null
}

interface TaskContext {
  cfg: FactoryConfig
  repo: string
  /** The host clone: judged, committed and pushed from here. */
  dir: string
  ws: Workspace
  base: string
  pkg: ReturnType<typeof readRepoBasics>['pkg']
  specs: CheckSpec[]
  baseline: CheckResult[]
  args: Args
  aliases: string[]
  dataClass: ReturnType<typeof classifyRepoData>
  audit: AuditCounts | null
}

/**
 * Route one task and climb the ladder on failure.
 *   pr / verified → done with this repo
 *   deferred      → free quota/rate limit; try another task
 *   failed        → every allowed tier failed; try another task
 *   stop          → hit the paid boundary (approval needed); stop this repo
 */
async function runLadder(ctx: TaskContext, task: FactoryTask, ledger: ReturnType<typeof readLedger>, now: Date): Promise<'pr' | 'verified' | 'reported' | 'deferred' | 'failed' | 'stop'> {
  const { cfg, repo } = ctx
  if (task.kind === 'red-ci' && cfg.capabilities['red-ci'] === 'report') {
    // Investigation only, on the free pool (one read-only agent run; never escalates to paid).
    if (!ctx.aliases.includes(cfg.models.M1) || ctx.dataClass !== 'public' && !cfg.allowFreeCloud.includes(repo)) {
      log(`${repo}: red-ci investigation needs the free pool (M1) — skipped`)
      return 'failed'
    }
    const pool = Object.entries(readManagedModels(readFileSync(cfg.litellm.configPath, 'utf8'))).filter(([alias]) => alias.startsWith('free-agent')).map(([, id]) => id)
    const deferred = m1Deferred(pool, await freeQuota(cfg))
    if (deferred) { log(`${repo}: ${deferred} — deferring red-ci investigation`); return 'deferred' }
    return investigate(ctx, task)
  }
  if (task.kind === 'deps-audit' || task.kind === 'lint-autofix') {
    // Deterministic: `npm audit fix` / the repo's own lint fixer (no model, no quota), judged like any other change.
    log(`${repo}: ${task.kind} → ${task.kind === 'deps-audit' ? 'npm audit fix' : "repo's lint fixer"} (no model)`)
    const r = await attempt(ctx, task, 'M0', false, ctx.audit)
    return r === 'rate_limited' ? 'deferred' : r
  }
  const usage = todaysUsage(ledger, now)
  // The Copilot CLI authenticates with the owner's GitHub login, which never enters the sandbox.
  const copilot = !ctx.ws.sandbox && cfg.copilot.enabled && copilotInstalled && copilotQuotaLeft && usage.copilotTasks < cfg.copilot.maxTasksPerDay
  const allowed = allowedTiers(task, ctx.dataClass, { allowFreeCloud: cfg.allowFreeCloud.includes(repo), copilot })
    // M0/M1 need their LiteLLM alias; MC is the Copilot CLI and M2 is gated by budget below.
    .filter(t => t === 'M2' || t === 'MC' || ctx.aliases.includes(cfg.models[t]))
  const decision = chooseTier({ allowed, stats: computeTierStats(toAttemptRecords(ledger), task.kind, now) })
  log(`${repo}: ${task.kind}${task.scoped ? '' : ' (unscoped)'} → ${decision.tier ?? 'none'} (${decision.reason}); allowed ${allowed.join(',') || 'none'}; data=${ctx.dataClass}`)

  let tier: ModelTier | null = decision.tier
  let exploring = decision.exploring
  let parentId: string | null = null
  while (tier) {
    if (tier === 'M2' && !canUsePaidTier({ monthToDateUsd: monthToDateUsd(readLedger(cfg.home), new Date()), monthlyBudgetUsd: cfg.monthlyBudgetUsd }, cfg.m2EstimateUsd)) {
      const reason = cfg.monthlyBudgetUsd <= 0 ? 'paid tier disabled (monthlyBudgetUsd = 0)' : 'monthly paid budget exhausted'
      appendEntry(cfg.home, { type: 'approval_needed', runId, at: new Date().toISOString(), repo, kind: task.kind, reason })
      await recordApprovalNeeded(cfg, repo, `Factory needs approval: ${task.title} in ${repo}`, `Free tiers could not complete this task; ${reason}. Raise FACTORY_MONTHLY_BUDGET_USD to allow M2, or fix manually.`)
      log(`${repo}: stopping at M2 — ${reason}`)
      return 'stop'
    }
    if (tier === 'M1') {
      const pool = Object.entries(readManagedModels(readFileSync(cfg.litellm.configPath, 'utf8')))
        .filter(([alias]) => alias.startsWith('free-agent')).map(([, id]) => id)
      const deferred = m1Deferred(pool, await freeQuota(cfg))
      if (deferred) {
        // No free capacity is "wait", never "escalate to paid" (docs/autonomous-factory.md §3).
        log(`${repo}: ${deferred} — deferring ${task.kind} to the next cycle`)
        return 'deferred'
      }
    }
    const result = await attempt(ctx, task, tier, exploring, null, parentId)
    if (result === 'pr' || result === 'verified') return result
    if (result === 'rate_limited') return 'deferred'
    // The next tier's job is the child of this failed one (escalation chain, Phase 79).
    parentId = lastAttemptId
    tier = nextTier(tier, allowed)
    exploring = false
  }
  return 'failed'
}

async function attempt(
  ctx: TaskContext, task: FactoryTask, tier: ModelTier, exploring: boolean, auditBefore: AuditCounts | null = null, parentId: string | null = null,
): Promise<'pr' | 'verified' | 'failed' | 'rate_limited'> {
  const { cfg, repo, dir, ws, base, pkg, specs, baseline, args } = ctx
  const deps = task.kind === 'deps-audit'
  const lintFix = task.kind === 'lint-autofix'
  const lintSpec = specs.find(s => s.name === 'lint')
  const now = new Date()
  const branch = branchName(task, now, runId)
  await checkoutNewBranch(ws.dir, base, branch, ws.run)
  const model = deps || lintFix ? 'npm' : cfg.models[tier]
  const promptPkg = { ...pkg, scripts: collectPackageInfo(dir).scripts }
  const prompt = deps ? 'npm audit fix' : lintFix ? (lintSpec?.display ?? 'lint') : buildPrompt(task, tier, promptPkg, specs.filter(s => task.verify.includes(s.name)).map(s => s.display), repo)
  if (!deps && !lintFix) log(`${repo}: ${tier} ${harnessFor(tier)} → ${model}${ws.sandbox ? ' (sandboxed)' : ''}`)

  // Inside the sandbox the agent reaches LiteLLM through the egress relay, not localhost.
  const harnessCfg: FactoryConfig = ws.sandbox ? { ...cfg, litellm: { ...cfg.litellm, url: ws.sandbox.litellmUrl } } : cfg
  const h: HarnessResult = deps ? await npmAuditFix(ws, cfg) : lintFix ? await runLintFixer(ws, lintSpec, cfg) : await runHarness({
    tier, model, cwd: ws.dir, prompt, files: task.scoped ? task.files : undefined,
    timeoutMs: tier === 'M0' ? cfg.m0TimeoutMs : undefined,
    // Claude Code's small-model role → local Ollama (falls back to the pool). Measured: zero
    // such calls in headless --bare runs today, so this is insurance, not a saving.
    smallModel: tier === 'M1' ? 'local-small' : undefined,
  }, harnessCfg, ws.run)
  writeFileSync(path.join(logDir, `${slug(repo)}-${task.kind}-${tier}.log`), `${prompt}\n\n=====\n${h.output}`)

  const entry: AttemptEntry = {
    type: 'attempt', id: randomUUID(), runId, at: now.toISOString(), repo, kind: task.kind, taskTier: task.taskTier,
    tier, model, harness: h.harness, outcome: 'failed', reason: '', exploring, isolation: ws.sandbox ? 'docker' : 'host',
    ...(task.ci ? { ciWorkflow: task.ci.workflow } : {}),
    ...(task.ownerTaskId ? { ownerTaskId: task.ownerTaskId } : {}),
    durationMs: h.durationMs, costUsd: h.costUsd, inputTokens: h.inputTokens, outputTokens: h.outputTokens,
    requests: h.requests, ...(parentId ? { parentId } : {}),
  }

  if (h.rateLimited && !h.ok) {
    entry.outcome = 'rate_limited'
    entry.reason = 'free-tier rate limit — will retry next cycle (never escalates to paid)'
    appendEntry(cfg.home, entry)
    log(`${repo}: ${tier} rate limited`)
    return 'rate_limited'
  }

  // Snapshot the model's edits, then run the checks. If the repo's own checks rewrite
  // files (eslint --fix, prettier --write), fold that in and re-check, so the judge
  // sees exactly what would ship.
  const baseSha = await headSha(ws.dir, ws.run)
  const edits = await diffInfo(ws.dir, ws.run)
  let after = baseline
  if (edits.files.length > 0) {
    await commitAll(ws.dir, 'factory: wip', ws.run)
    after = await runChecks(specs, ws.dir, cfg.checkTimeoutMs, ws.run)
    if ((await diffInfo(ws.dir, ws.run)).files.length > 0) {
      if (deps) {
        // A dependency PR must contain only package files: drop the lint fixer's rewrite.
        await resetWorktree(ws.dir, ws.run)
      } else {
        await commitAll(ws.dir, 'factory: wip (repo check autofix)', ws.run)
        after = await runChecks(specs, ws.dir, cfg.checkTimeoutMs, ws.run)
        await resetWorktree(ws.dir, ws.run)
      }
    }
  }
  // Sandbox: bring the result back to the host clone as a patch (file contents only — nothing
  // is executed here). From this point the host clone is exactly what gets judged and pushed.
  let hostBase = baseSha
  if (ws.sandbox) {
    await checkoutNewBranch(dir, base, branch)
    hostBase = await headSha(dir)
    if (edits.files.length > 0) {
      const patchFile = path.join(logDir, `${slug(repo)}-${task.kind}-${tier}.patch`)
      await ws.sandbox.exportPatch(baseSha, patchFile)
      await applyPatchAndCommit(dir, patchFile, 'factory: sandbox result')
    }
  }
  const diff = edits.files.length > 0 ? await diffAgainst(dir, hostBase) : edits
  const readmeAfter = existsSync(path.join(dir, 'README.md')) ? readFileSync(path.join(dir, 'README.md'), 'utf8') : null
  // Scripts/deps from every package.json (root + sub-packages like client/, server/).
  const judgeInputs = diff.files.length > 0 ? {
    ...collectPackageInfo(dir), readmeAfter, repo, repoFiles: await listFiles(dir), modelEdits: edits as DiffInfo,
    audit: deps ? { before: auditBefore, after: await runAudit(ws.dir, undefined, ws.run) } : undefined,
    lintProblems: lintFix ? { before: lintProblems(baseline.find(b => b.name === 'lint')), after: lintProblems(after.find(a => a.name === 'lint')) } : undefined,
  } : null
  const verdict = judgeInputs
    ? judge({ task, baseline, after, diff, ...judgeInputs })
    : { ok: false, reason: h.ok ? 'no changes made' : `harness failed${h.timedOut ? ' (timeout)' : ''}` }
  entry.reason = verdict.reason
  if (judgeInputs) {
    // Kept so any verdict later shown wrong can become a regression fixture (npm run factory:judge-fixture).
    const record: JudgeInputRecord = {
      attemptId: entry.id, repo, task, baseline: baseline.map(trimCheck), after: after.map(trimCheck),
      patch: await patchText(dir, hostBase), scripts: judgeInputs.scripts, deps: judgeInputs.deps, readmeAfter,
      repoFiles: judgeInputs.repoFiles, lintProblems: judgeInputs.lintProblems, audit: judgeInputs.audit, verdict,
    }
    writeFileSync(path.join(logDir, `${slug(repo)}-${task.kind}-${tier}.judge.json`), JSON.stringify(record))
  }
  log(`${repo}: ${tier} ${verdict.ok ? 'VERIFIED' : 'rejected'} — ${verdict.reason}`)

  // Advisory adversarial pass (Phase 77): only after the deterministic judge passed, only for
  // model-written changes, and it can never approve, only label or (once promoted) veto.
  let adversary: AdversaryResult | null = null
  if (verdict.ok && !deps && !lintFix) {
    adversary = await runAdversary(cfg, tier, task, await patchText(dir, hostBase, 3))
    if (adversary) {
      entry.adversary = { model: adversary.model, verdict: adversary.verdict, issues: adversary.issues.length }
      log(`${repo}: adversarial review (${adversary.model}): ${adversary.verdict}${adversary.issues.length ? ` — ${adversary.issues.map(i => i.why).join('; ').slice(0, 200)}` : ''}`)
      if (adversaryAction(adversary, cfg.capabilities['adversarial-veto']) === 'reject') {
        const veto: Verdict = { ok: false, reason: `adversarial review vetoed: ${adversary.issues[0]?.why ?? 'FAIL'}` }
        verdict.ok = veto.ok
        verdict.reason = veto.reason
        entry.reason = veto.reason
      }
    }
  }

  if (!verdict.ok) {
    appendEntry(cfg.home, entry)
    lastAttemptId = entry.id
    await recordAttempt(cfg, entry, task.title)
    await resetWorktree(ws.dir, ws.run)
    if (ws.sandbox) await resetWorktree(dir)
    return 'failed'
  }

  entry.outcome = 'verified'
  entry.branch = branch
  await squashOnto(dir, hostBase, commitMessage(task, tier, model))
  // Promotion ladder (Phase 75): a `report` capability proves itself in the morning report first.
  const reportOnly = cfg.capabilities[task.kind] === 'report'
  if (reportOnly) {
    entry.reported = true
    log(`${repo}: ${task.kind} is at stage "report" — verified result recorded for the morning report, no PR`)
  }
  if (!args.dryRun && !reportOnly) {
    await pushBranch(dir, branch)
    entry.prUrl = await createDraftPr(dir, {
      base, head: branch, title: prTitle(task),
      body: prBody({ task, tier, model, harness: h.harness, verdict: verdict.reason, baseline, after, diff, durationMs: h.durationMs, costUsd: h.costUsd, exploring }) + adversarySection(adversary).join('\n'),
    })
    log(`${repo}: draft PR ${entry.prUrl}`)
    if (task.ownerTaskId && await addPrLabel(entry.prUrl, repo, 'owner-requested')) {
      log(`${repo}: labelled owner-requested (reviewed as owner intent, never auto-merged)`)
    }
    if (adversaryAction(adversary, cfg.capabilities['adversarial-veto']) === 'label' && await addPrLabel(entry.prUrl, repo, NEEDS_REVIEW_LABEL)) {
      log(`${repo}: labelled ${NEEDS_REVIEW_LABEL} (adversarial review ${adversary?.verdict})`)
    }
    if (cfg.copilot.review && copilotQuotaLeft && todaysUsage(readLedger(cfg.home), new Date()).copilotReviews < cfg.copilot.maxReviewsPerDay) {
      entry.reviewRequested = await requestCopilotReview(entry.prUrl)
      if (entry.reviewRequested) log(`${repo}: Copilot review requested`)
    }
  }
  appendEntry(cfg.home, entry)
  lastAttemptId = entry.id
  await recordAttempt(cfg, entry, task.title)
  return args.dryRun || reportOnly ? 'verified' : 'pr'
}

/**
 * red-ci at stage `report` (Phase 78): a root-cause investigation in the sandbox. Verified = the
 * agent produced the structured report; the findings go to the morning report, no PR. Any file
 * changes are discarded: reproducing a failure runs the repo's own scripts, which may rewrite
 * files (Figma-Jira's `eslint --fix` did on the first live run), and nothing from it ships.
 */
async function investigate(ctx: TaskContext, task: FactoryTask): Promise<'reported' | 'failed' | 'deferred'> {
  const { cfg, repo, ws } = ctx
  const now = new Date()
  const harnessCfg: FactoryConfig = ws.sandbox ? { ...cfg, litellm: { ...cfg.litellm, url: ws.sandbox.litellmUrl } } : cfg
  await resetWorktree(ws.dir, ws.run)
  log(`${repo}: red-ci → M1 claude-code → ${cfg.models.M1} (read-only investigation${ws.sandbox ? ', sandboxed' : ''})`)
  const h = await runHarness({ tier: 'M1', model: cfg.models.M1, smallModel: 'local-small', cwd: ws.dir, prompt: investigationPrompt(task), readOnly: true }, harnessCfg, ws.run)
  writeFileSync(path.join(logDir, `${slug(repo)}-red-ci-investigation.log`), `${investigationPrompt(task)}\n\n=====\n${h.output}`)
  const discarded = (await diffInfo(ws.dir, ws.run)).files.length
  await resetWorktree(ws.dir, ws.run)
  const findings = h.ok ? parseFindings(h.text ?? h.output) : null
  const entry: AttemptEntry = {
    type: 'attempt', id: randomUUID(), runId, at: now.toISOString(), repo, kind: task.kind, taskTier: task.taskTier,
    tier: 'M1', model: cfg.models.M1, harness: h.harness, exploring: false, reported: true,
    outcome: h.rateLimited && !h.ok ? 'rate_limited' : findings ? 'verified' : 'failed',
    reason: (findings ? `investigated: ${task.title}` : h.ok ? 'no structured root-cause report' : `harness failed${h.timedOut ? ' (timeout)' : ''}`)
      + (discarded ? ` (${discarded} file change(s) from reproducing it discarded)` : ''),
    durationMs: h.durationMs, costUsd: h.costUsd, inputTokens: h.inputTokens, outputTokens: h.outputTokens, requests: h.requests,
    isolation: ws.sandbox ? 'docker' : 'host', ciWorkflow: task.ci?.workflow, ...(findings ? { findings } : {}),
  }
  appendEntry(cfg.home, entry)
  await recordAttempt(cfg, entry, task.title)
  log(`${repo}: red-ci investigation ${findings ? 'REPORTED' : 'failed'} — ${findings ? findings.split('\n').find(l => l.trim() && !l.startsWith('#'))?.slice(0, 160) : entry.reason}`)
  if (entry.outcome === 'rate_limited') return 'deferred'
  return findings ? 'reported' : 'failed'
}

/** Non-breaking dependency fixes only — never `--force` (that would allow semver-major upgrades). */
/** Run the repo's own lint script once to let its fixer (eslint --fix / prettier --write) rewrite files. */
async function runLintFixer(ws: Workspace, spec: CheckSpec | undefined, cfg: FactoryConfig): Promise<HarnessResult> {
  const r = spec ? await ws.run(spec.cmd, spec.args, { cwd: ws.dir, timeoutMs: cfg.checkTimeoutMs, env: { CI: '1', NO_COLOR: '1' } }) : null
  return {
    requests: 0,
    // Lint may still fail afterwards (remaining errors); success here means the fixer ran.
    ok: !!r && !r.timedOut, harness: 'lint-autofix', model: 'npm', output: r?.output ?? 'no lint script',
    durationMs: r?.durationMs ?? 0, inputTokens: 0, outputTokens: 0, costUsd: 0, rateLimited: false, timedOut: r?.timedOut ?? false,
  }
}

async function npmAuditFix(ws: Workspace, cfg: FactoryConfig): Promise<HarnessResult> {
  const r = await ws.run('npm', ['audit', 'fix', '--no-fund'], { cwd: ws.dir, timeoutMs: cfg.checkTimeoutMs })
  return {
    requests: 0,
    ok: r.code === 0 || /fixed \d+ of \d+/i.test(r.output), harness: 'npm-audit-fix', model: 'npm', output: r.output,
    durationMs: r.durationMs, inputTokens: 0, outputTokens: 0, costUsd: 0, rateLimited: false, timedOut: r.timedOut,
  }
}

function printReport(cfg: FactoryConfig) {
  const ledger = readLedger(cfg.home)
  const rows = summarizeByTier(ledger)
  const verified = rows.reduce((n, r) => n + r.verified, 0)
  const free = rows.filter(r => r.tier !== 'M2').reduce((n, r) => n + r.verified, 0)
  console.log('\ntier  attempts  verified  merged  rejected   cost')
  for (const r of rows) console.log(`${r.tier.padEnd(5)} ${String(r.attempts).padStart(8)} ${String(r.verified).padStart(9)} ${String(r.merged).padStart(7)} ${String(r.rejected).padStart(9)}  $${r.costUsd.toFixed(2)}`)
  console.log(`$0 share of verified fixes: ${verified ? Math.round((free / verified) * 100) : 0}% · paid this month: $${monthToDateUsd(ledger, new Date()).toFixed(2)} / $${cfg.monthlyBudgetUsd}`)
  console.log(`open factory PRs: ${openPrAttempts(ledger).length}`)
  console.log(readinessLine(nightShiftReadiness(ledger)))
}

function slug(repo: string) {
  return repo.replace(/[^\w.-]+/g, '_')
}

main().catch(err => {
  console.error('[factory] failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
