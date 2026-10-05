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
import { confirmFailures, detectPackageManager, installCommand, planChecks, readRepoBasics, readmeIssue, runChecks, type CheckResult, type CheckSpec } from './lib/checks'
import { checkoutNewBranch, cloneRepo, commitAll, createDraftPr, currentBranch, diffAgainst, diffInfo, headSha, prState, pushBranch, repoVisibility, resetWorktree, squashOnto } from './lib/git'
import { harnessFor, runHarness } from './lib/harness'
import { appendEntry, deadEnds, monthToDateUsd, nextRepos, openPrAttempts, readLedger, summarizeByTier, toAttemptRecords, type AttemptEntry } from './lib/ledger'
import { listAliases } from './lib/litellm-ops'
import { branchName, commitMessage, prBody, prTitle } from './lib/pr'
import { run } from './lib/proc'
import { recordApprovalNeeded, recordAttempt, recordResolution } from './lib/sink'
import { acquireLock } from './lib/lock'
import { freeQuota, m1Deferred } from './lib/quota'
import { readManagedModels } from './lib/litellm-config'
import { buildPrompt, filterTasks, fitLocalContext, tasksFromScan, type FactoryTask } from './lib/tasks'
import { judge } from './lib/verify'

interface Args { dryRun: boolean; repo: string | null; maxRepos: number; report: boolean; keep: boolean }

function parseArgs(argv: string[]): Args {
  const val = (k: string) => argv.find(a => a.startsWith(`--${k}=`))?.split('=')[1] ?? null
  return {
    dryRun: argv.includes('--dry-run'),
    repo: val('repo'),
    maxRepos: Number(val('max-repos') ?? 3),
    report: argv.includes('--report'),
    keep: argv.includes('--keep'),
  }
}

const runId = `${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12)}-${randomUUID().slice(0, 4)}`
let logDir = ''
const log = (...a: unknown[]) => console.log(`[factory ${new Date().toISOString().slice(11, 19)}]`, ...a)

async function main() {
  const args = parseArgs(process.argv.slice(2))
  const cfg = loadConfig()
  mkdirSync(cfg.home, { recursive: true })
  logDir = path.join(cfg.home, 'logs', runId)

  if (args.report) return printReport(cfg)
  if (existsSync(path.join(cfg.home, 'PAUSE'))) return log(`paused (${path.join(cfg.home, 'PAUSE')} exists) — nothing to do`)
  if (cfg.repos.length === 0 && !args.repo) throw new Error('no repos in factory.config.json allowlist')
  if (args.repo && !cfg.repos.includes(args.repo)) throw new Error(`${args.repo} is not in the allowlist`)

  acquireLock(cfg.home, `run ${runId}`)
  mkdirSync(logDir, { recursive: true })
  log(`run ${runId}${args.dryRun ? ' (dry run)' : ''}`)

  await reconcile(cfg)

  const aliases = await listAliases(cfg).catch((): string[] => [])
  for (const t of ['M0', 'M1'] as const) {
    if (!aliases.includes(cfg.models[t])) log(`warning: LiteLLM alias ${cfg.models[t]} (${t}) not available`)
  }
  if (aliases.length === 0) throw new Error('LiteLLM gateway is down — see ~/ai-stack/README.md troubleshooting')

  const queue = args.repo ? [args.repo] : nextRepos(readLedger(cfg.home), cfg.repos).slice(0, args.maxRepos)
  let prs = 0
  for (const repo of queue) {
    if (prs >= cfg.maxPrsPerCycle) break
    try {
      prs += await improveRepo(cfg, repo, args, aliases)
    } catch (err) {
      log(`${repo}: ${err instanceof Error ? err.message : err}`)
    }
  }
  log(`done — ${prs} PR(s) opened`)
  printReport(cfg)
}

/** Learn step: merged/closed factory PRs become resolutions the router reads. */
async function reconcile(cfg: FactoryConfig) {
  const open = openPrAttempts(readLedger(cfg.home))
  for (const a of open) {
    const state = await prState(a.prUrl!)
    if (state === 'MERGED' || state === 'CLOSED') {
      const outcome = state === 'MERGED' ? 'merged' : 'rejected'
      appendEntry(cfg.home, { type: 'resolution', attemptId: a.id, at: new Date().toISOString(), outcome })
      await recordResolution(cfg, a.id, outcome)
      log(`reconciled ${a.prUrl} → ${state.toLowerCase()}`)
    }
  }
}

/** Returns the number of PRs opened (0 or 1). */
async function improveRepo(cfg: FactoryConfig, repo: string, args: Args, aliases: string[]): Promise<number> {
  const dir = path.join(cfg.home, 'work', runId, repo.replace('/', '__'))
  log(`${repo}: cloning`)
  await cloneRepo(repo, dir)
  try {
    const base = await currentBranch(dir)
    const basics = readRepoBasics(dir)
    let specs: CheckSpec[] = []
    let baseline: CheckResult[] = []

    if (basics.pkg && !basics.pkg.workspaces) {
      const pm = detectPackageManager(basics.files)
      const install = installCommand(pm, basics.files)
      log(`${repo}: ${install.cmd} ${install.args.join(' ')}`)
      let ins = await run(install.cmd, install.args, { cwd: dir, timeoutMs: cfg.checkTimeoutMs })
      if (ins.code !== 0 && /ETIMEDOUT|ECONNRESET|EAI_AGAIN|network/i.test(ins.output)) {
        log(`${repo}: install hit a network error — retrying once`)
        ins = await run(install.cmd, install.args, { cwd: dir, timeoutMs: cfg.checkTimeoutMs })
      }
      if (ins.code !== 0) {
        writeFileSync(path.join(logDir, `${slug(repo)}-install.log`), ins.output)
        appendEntry(cfg.home, { type: 'scan', runId, at: new Date().toISOString(), repo, checks: { install: false }, tasks: [] })
        log(`${repo}: install failed — skipping (log in ${logDir})`)
        return 0
      }
      specs = planChecks(basics.pkg, pm, basics.hasTsconfig)
      baseline = await runChecks(specs, dir, cfg.checkTimeoutMs)
      for (const b of baseline) writeFileSync(path.join(logDir, `${slug(repo)}-baseline-${b.name}.log`), b.output)
      if (baseline.some(b => !b.ok)) {
        const confirmed = await confirmFailures(specs, baseline, dir, cfg.checkTimeoutMs)
        if (confirmed.flaky.length > 0) log(`${repo}: ${confirmed.flaky.join(', ')} failed once then passed — treated as flaky, not a task`)
        baseline = confirmed.results
      }
      // Some repos' checks write files (e.g. `eslint . --fix`). Start every attempt from a clean tree.
      const sideEffects = await diffInfo(dir)
      if (sideEffects.files.length > 0) {
        log(`${repo}: checks modified ${sideEffects.files.length} tracked file(s) (auto-fixing lint/format script) — discarded`)
        await resetWorktree(dir)
      }
    }

    const ledger = readLedger(cfg.home)
    const now = new Date()
    const openKinds = new Set(openPrAttempts(ledger).map(a => `${a.repo}:${a.kind}`))
    const allTasks = tasksFromScan(baseline, specs, readmeIssue(basics.readme), dir)
    const tasks = filterTasks(allTasks, repo, openKinds, deadEnds(ledger, now))
    appendEntry(cfg.home, {
      type: 'scan', runId, at: now.toISOString(), repo,
      checks: Object.fromEntries(baseline.map(b => [b.name, b.ok])),
      tasks: allTasks.map(t => t.kind),
    })
    log(`${repo}: checks ${baseline.map(b => `${b.name}=${b.ok ? 'ok' : 'FAIL'}`).join(' ') || '(none)'}; tasks: ${tasks.map(t => t.kind).join(', ') || 'none'}${allTasks.length > tasks.length ? ` (${allTasks.length - tasks.length} skipped: open PR or dead end)` : ''}`)

    const sizeOf = (f: string) => { try { return statSync(path.join(dir, f)).size } catch { return 0 } }
    const visibility = await repoVisibility(repo)
    const dataClass = classifyRepoData({ visibility })
    const ctx: TaskContext = { cfg, repo, dir, base, pkg: basics.pkg, specs, baseline, args, aliases, dataClass }

    // Try at most two tasks per repo: when free cloud quota defers the first,
    // local (M0) work on the next task still gets done this cycle.
    for (const t of tasks.slice(0, 2)) {
      const result = await runLadder(ctx, fitLocalContext(t, sizeOf), ledger, now)
      if (result === 'pr') return 1
      if (result === 'verified' || result === 'stop') return 0
    }
    return 0
  } finally {
    if (!args.keep) rmSync(dir, { recursive: true, force: true })
  }
}

interface TaskContext {
  cfg: FactoryConfig
  repo: string
  dir: string
  base: string
  pkg: ReturnType<typeof readRepoBasics>['pkg']
  specs: CheckSpec[]
  baseline: CheckResult[]
  args: Args
  aliases: string[]
  dataClass: ReturnType<typeof classifyRepoData>
}

/**
 * Route one task and climb the ladder on failure.
 *   pr / verified → done with this repo
 *   deferred      → free quota/rate limit; try another task
 *   failed        → every allowed tier failed; try another task
 *   stop          → hit the paid boundary (approval needed); stop this repo
 */
async function runLadder(ctx: TaskContext, task: FactoryTask, ledger: ReturnType<typeof readLedger>, now: Date): Promise<'pr' | 'verified' | 'deferred' | 'failed' | 'stop'> {
  const { cfg, repo } = ctx
  const allowed = allowedTiers(task, ctx.dataClass, { allowFreeCloud: cfg.allowFreeCloud.includes(repo) })
    .filter(t => t === 'M2' || ctx.aliases.includes(cfg.models[t]))
  const decision = chooseTier({ allowed, stats: computeTierStats(toAttemptRecords(ledger), task.kind, now) })
  log(`${repo}: ${task.kind}${task.scoped ? '' : ' (unscoped)'} → ${decision.tier ?? 'none'} (${decision.reason}); allowed ${allowed.join(',') || 'none'}; data=${ctx.dataClass}`)

  let tier: ModelTier | null = decision.tier
  let exploring = decision.exploring
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
    const result = await attempt(cfg, repo, ctx.dir, ctx.base, task, tier, exploring, ctx.pkg, ctx.specs, ctx.baseline, ctx.args)
    if (result === 'pr' || result === 'verified') return result
    if (result === 'rate_limited') return 'deferred'
    tier = nextTier(tier, allowed)
    exploring = false
  }
  return 'failed'
}

async function attempt(
  cfg: FactoryConfig, repo: string, dir: string, base: string, task: FactoryTask, tier: ModelTier, exploring: boolean,
  pkg: ReturnType<typeof readRepoBasics>['pkg'], specs: CheckSpec[], baseline: CheckResult[], args: Args,
): Promise<'pr' | 'verified' | 'failed' | 'rate_limited'> {
  const now = new Date()
  const branch = branchName(task, now, runId)
  await checkoutNewBranch(dir, base, branch)
  const model = cfg.models[tier]
  const prompt = buildPrompt(task, tier, pkg, specs.filter(s => task.verify.includes(s.name)).map(s => s.display), repo)
  log(`${repo}: ${tier} ${harnessFor(tier)} → ${model}`)

  const h = await runHarness({
    tier, model, cwd: dir, prompt, files: task.scoped ? task.files : undefined,
    timeoutMs: tier === 'M0' ? cfg.m0TimeoutMs : undefined,
    // Claude Code's small-model role → local Ollama (falls back to the pool). Measured: zero
    // such calls in headless --bare runs today, so this is insurance, not a saving.
    smallModel: tier === 'M1' ? 'local-small' : undefined,
  }, cfg)
  writeFileSync(path.join(logDir, `${slug(repo)}-${task.kind}-${tier}.log`), `${prompt}\n\n=====\n${h.output}`)

  const entry: AttemptEntry = {
    type: 'attempt', id: randomUUID(), runId, at: now.toISOString(), repo, kind: task.kind, taskTier: task.taskTier,
    tier, model, harness: h.harness, outcome: 'failed', reason: '', exploring,
    durationMs: h.durationMs, costUsd: h.costUsd, inputTokens: h.inputTokens, outputTokens: h.outputTokens,
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
  const baseSha = await headSha(dir)
  const edits = await diffInfo(dir)
  let after = baseline
  if (edits.files.length > 0) {
    await commitAll(dir, 'factory: wip')
    after = await runChecks(specs, dir, cfg.checkTimeoutMs)
    if ((await diffInfo(dir)).files.length > 0) {
      await commitAll(dir, 'factory: wip (repo check autofix)')
      after = await runChecks(specs, dir, cfg.checkTimeoutMs)
      await resetWorktree(dir)
    }
  }
  const diff = edits.files.length > 0 ? await diffAgainst(dir, baseSha) : edits
  const readmeAfter = existsSync(path.join(dir, 'README.md')) ? readFileSync(path.join(dir, 'README.md'), 'utf8') : null
  const verdict = diff.files.length > 0
    ? judge({ task, baseline, after, diff, scripts: pkg?.scripts, deps: Object.keys({ ...pkg?.dependencies, ...pkg?.devDependencies }), readmeAfter })
    : { ok: false, reason: h.ok ? 'no changes made' : `harness failed${h.timedOut ? ' (timeout)' : ''}` }
  entry.reason = verdict.reason
  log(`${repo}: ${tier} ${verdict.ok ? 'VERIFIED' : 'rejected'} — ${verdict.reason}`)

  if (!verdict.ok) {
    appendEntry(cfg.home, entry)
    await recordAttempt(cfg, entry, task.title)
    await resetWorktree(dir)
    return 'failed'
  }

  entry.outcome = 'verified'
  entry.branch = branch
  await squashOnto(dir, baseSha, commitMessage(task, tier, model))
  if (!args.dryRun) {
    await pushBranch(dir, branch)
    entry.prUrl = await createDraftPr(dir, {
      base, head: branch, title: prTitle(task),
      body: prBody({ task, tier, model, harness: h.harness, verdict: verdict.reason, baseline, after, diff, durationMs: h.durationMs, costUsd: h.costUsd, exploring }),
    })
    log(`${repo}: draft PR ${entry.prUrl}`)
  }
  appendEntry(cfg.home, entry)
  await recordAttempt(cfg, entry, task.title)
  return args.dryRun ? 'verified' : 'pr'
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
}

function slug(repo: string) {
  return repo.replace(/[^\w.-]+/g, '_')
}

main().catch(err => {
  console.error('[factory] failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
