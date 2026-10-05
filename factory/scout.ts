/**
 * Model scout (Phase 64/68) — weekly, $0.
 *
 *   npx tsx factory/scout.ts            # evaluate candidates, update the free-agent pool
 *   npx tsx factory/scout.ts --dry-run  # evaluate only; leave aliases unchanged
 *
 * Maintains a redundant free model pool in LiteLLM so no single provider's quota
 * stops the agent (docs/autonomous-factory.md §3):
 *
 *   free-agent → free-agent-b → free-agent-c      (LiteLLM fallbacks, free-only)
 *
 * 1. Discovers candidates on three independent free tiers: Gemini (Google AI
 *    Studio), Ollama Cloud (free plan, tool-calling models), OpenRouter (:free).
 * 2. Exposes them as scout-N aliases and runs the eval suite through Claude Code.
 * 3. Ranks today's results with 21 days of history and writes a provider-diverse
 *    chain, keeps local-agent on Ollama, and commits the change in ~/ai-stack.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { loadConfig } from './lib/config'
import { EVAL_CASES, runEval, type EvalOutcome } from './lib/evals'
import { appendEntry } from './lib/ledger'
import { memberFor, parsePoolId, poolId, readManagedModels, type ManagedModel, type PoolId } from './lib/litellm-config'
import { applyLiteLLMModels, commitStackConfig } from './lib/litellm-ops'
import { discoverGemini, discoverOllamaCloud } from './lib/providers'
import { historicalOutcomes, isFreeToolModel, pickPool, providerOf, rankModels, selectCandidates, type OpenRouterModel } from './lib/scout-select'
import { recordScout } from './lib/sink'
import { freeQuota, SCOUT_REQUESTS_PER_CASE } from './lib/quota'
import { acquireLock } from './lib/lock'

const LOCAL_AGENT: ManagedModel = { name: 'local-agent', model: 'qwen2.5:7b-coding', kind: 'ollama', numCtx: 16384 }
/**
 * Claude Code's small-model role (bash-prefix checks, titles, summaries) on local Ollama:
 * same resident model as local-agent (no extra RAM), but it falls back to the free pool
 * on error so a local hiccup never fails an M1 run.
 */
const LOCAL_SMALL: ManagedModel = { ...LOCAL_AGENT, name: 'local-small' }
const POOL_ALIASES = ['free-agent', 'free-agent-b', 'free-agent-c']
const RETEST_AFTER_DAYS = 3

const log = (...a: unknown[]) => console.log(`[scout ${new Date().toISOString().slice(11, 19)}]`, ...a)

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const perProvider = Number(process.argv.find(a => a.startsWith('--per-provider='))?.split('=')[1] ?? 2)
  const cfg = loadConfig()
  acquireLock(cfg.home, 'scout')

  const configText = readFileSync(cfg.litellm.configPath, 'utf8')
  const current = readManagedModels(configText)
  // First run: the hand-configured cloud-or model is the incumbent, so a scout
  // that can't evaluate anything still leaves a working free-agent.
  const cloudOr = /model_name: cloud-or\n\s+litellm_params:\n\s+model: openrouter\/(\S+)/.exec(configText)?.[1]
  const incumbents = POOL_ALIASES.map(a => current[a]).filter((x): x is PoolId => !!x)
  if (incumbents.length === 0 && cloudOr) incumbents.push(poolId('openrouter', cloudOr))

  // ── Discover candidates on each free provider ──────────────────────────────
  const res = await fetch('https://openrouter.ai/api/v1/models')
  const orModels = res.ok ? ((await res.json()) as { data: OpenRouterModel[] }).data : []
  const reportDir = path.join(cfg.home, 'scout-reports')
  const reports = readReports(reportDir)
  const tested = lastTested(reports)

  const quota = await freeQuota(cfg)
  const orCases = quota ? Math.floor(quota.remaining / SCOUT_REQUESTS_PER_CASE) : Infinity
  if (quota) log(`OpenRouter free quota: ${quota.remaining}/${quota.limit} requests left today (~${orCases} eval cases)`)
  const orAffordable = Math.min(perProvider, Math.floor(orCases / EVAL_CASES.length))
  const orIncumbents = incumbents.filter(i => providerOf(i) === 'openrouter').map(i => parsePoolId(i).model)
  const orTested = Object.fromEntries(Object.entries(tested).map(([k, v]) => [parsePoolId(k).model, v]))
  const openrouter = orAffordable > 0
    ? selectCandidates(orModels, orIncumbents, orAffordable, orTested).map(m => poolId('openrouter', m))
    : []
  const gemini = await discoverGemini(cfg, perProvider)
  const ollamaCloud = await discoverOllamaCloud(cfg, perProvider)

  const available = new Set<PoolId>([
    ...orModels.filter(isFreeToolModel).map(m => poolId('openrouter', m.id)),
    ...gemini, ...ollamaCloud,
  ])
  // Free quotas are precious: don't re-test anything evaluated in the last few days
  // (history still ranks it), and only re-test OpenRouter models when its quota allows.
  const fresh = (id: PoolId) => !!tested[id] && Date.now() - new Date(tested[id]).getTime() < RETEST_AFTER_DAYS * 86_400_000
  const retest = incumbents.filter(i => providerOf(i) !== 'openrouter' || orAffordable > 0)
  const candidates = [...new Set([...retest, ...gemini, ...ollamaCloud, ...openrouter])].filter(id => !fresh(id))
  log(`${candidates.length} candidates: ${candidates.join(', ') || '(none)'}`)

  const history = historicalOutcomes(
    reports.map(r => ({ ...r, outcomes: r.outcomes?.map(o => ({ ...o, model: normalize(o.model) })) })),
    new Set([...available, ...incumbents]),
    new Date(),
  )

  // ── Evaluate ───────────────────────────────────────────────────────────────
  const scoutAliases = candidates.map((id, i) => memberFor(`scout-${i + 1}`, id))
  const outcomes: EvalOutcome[] = []
  if (scoutAliases.length > 0) {
    // Keep the live pool working while candidates are evaluated.
    await applyLiteLLMModels(cfg, [...poolMembers(incumbents), ...scoutAliases], poolFallbacks(incumbents))
    log('LiteLLM reloaded with scout aliases')
    for (const alias of scoutAliases) {
      const id = poolId(alias.kind, alias.model)
      const pre = await preflight(cfg.litellm.url, cfg.litellm.key, alias.name)
      if (pre !== 'ok') {
        log(`${id.padEnd(52)} skipped — preflight ${pre}`)
        outcomes.push({ model: id, case: 'preflight', pass: false, detail: pre, durationMs: 0, rateLimited: pre === 'rate_limited' })
        continue
      }
      for (const c of EVAL_CASES) {
        const o = await runEval(c, alias.name, 'M1', cfg)
        outcomes.push({ ...o, model: id })
        log(`${id.padEnd(52)} ${c.name.padEnd(17)} ${o.pass ? 'PASS' : 'fail'} ${(o.durationMs / 1000).toFixed(0)}s ${o.detail}`)
        if (o.rateLimited) {
          log(`${id} rate limited — skipping its remaining cases`)
          break
        }
        if (alias.kind === 'openrouter') {
          const q = await freeQuota(cfg)
          if (q && q.remaining < SCOUT_REQUESTS_PER_CASE) {
            log(`OpenRouter quota nearly exhausted (${q.remaining} left) — skipping the rest of this model`)
            break
          }
        }
      }
    }
  } else {
    log('nothing to evaluate today — choosing from history')
  }

  // ── Pick a provider-diverse chain ──────────────────────────────────────────
  // Rate-limited cases say nothing about skill; a member needs ≥ 2 completed cases.
  const scores = rankModels([...history, ...outcomes].filter(o => !o.rateLimited && o.case !== 'preflight'))
  const chain = pickPool(scores, incumbents)
  log('ranking:', scores.map(s => `${s.model} ${s.passes}/${s.total} ~${Math.round(s.avgMs / 1000)}s`).join(' | ') || '(no data)')
  log('pool:', chain.map((id, i) => `${POOL_ALIASES[i]}=${id}`).join(' → ') || '(empty)')

  const final = dryRun ? incumbents : chain
  await applyLiteLLMModels(cfg, poolMembers(final), poolFallbacks(final))
  if (!dryRun && chain.join() !== incumbents.join()) {
    await commitStackConfig(cfg, `factory scout: pool ${chain.map((id, i) => `${POOL_ALIASES[i]}=${id}`).join(' ')}`)
  }

  const at = new Date().toISOString()
  mkdirSync(reportDir, { recursive: true })
  writeFileSync(path.join(reportDir, `${at.slice(0, 19).replace(/:/g, '')}.json`), JSON.stringify({ at, dryRun, candidates, outcomes, scores, chain }, null, 2))
  appendEntry(cfg.home, { type: 'scout', at, primary: chain[0] ?? null, backup: chain[1] ?? null, scores })
  await recordScout(cfg, { primary: chain[0] ?? null, backup: chain[1] ?? null, scores, dryRun })
  log(dryRun ? 'dry run — pool unchanged' : 'pool updated')
}

function poolMembers(chain: PoolId[]): ManagedModel[] {
  return [...chain.slice(0, POOL_ALIASES.length).map((id, i) => memberFor(POOL_ALIASES[i], id)), LOCAL_AGENT, LOCAL_SMALL]
}

/**
 * Fallbacks (LiteLLM doesn't chain fallbacks recursively, so every ladder is explicit):
 * - free-agent → the rest of the pool: free-only, across providers (a 429 on one moves to the next).
 *   local-agent never escalates on its own — the factory decides when to pay.
 * - cloud-or (hand-maintained OpenRouter alias) → the pool.
 * - local-coder (interactive agents, OpenClaw) → the pool → cloud-smart. The owner's
 *   policy: routine work local, free pool next, paid only as the last resort.
 */
function poolFallbacks(chain: PoolId[]): Record<string, string[]> {
  const aliases = POOL_ALIASES.slice(0, Math.min(chain.length, POOL_ALIASES.length))
  return {
    ...(aliases.length > 1 ? { 'free-agent': aliases.slice(1) } : {}),
    ...(aliases.length > 0 ? { 'cloud-or': aliases } : {}),
    'local-coder': [...aliases, 'cloud-smart'],
    ...(aliases.length > 0 ? { 'local-small': aliases } : {}),
  }
}

/** One tiny completion through LiteLLM — catches upstream throttling before a 5-minute eval does. */
async function preflight(url: string, key: string, alias: string): Promise<'ok' | 'rate_limited' | string> {
  try {
    const r = await fetch(`${url}/v1/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: alias, messages: [{ role: 'user', content: 'Reply with OK.' }], max_tokens: 64 }),
      signal: AbortSignal.timeout(90_000),
    })
    if (r.status === 429) return 'rate_limited'
    return r.ok ? 'ok' : `http ${r.status}`
  } catch (err) {
    return err instanceof Error ? err.message : 'error'
  }
}

type ScoutReport = { at: string; candidates?: string[]; outcomes?: EvalOutcome[] }

function readReports(reportDir: string): ScoutReport[] {
  if (!existsSync(reportDir)) return []
  return readdirSync(reportDir).filter(f => f.endsWith('.json')).sort().flatMap(f => {
    try {
      return [JSON.parse(readFileSync(path.join(reportDir, f), 'utf8')) as ScoutReport]
    } catch {
      return []
    }
  })
}

/** Reports written before the pool used bare OpenRouter slugs. */
function normalize(id: string): PoolId {
  const { kind, model } = parsePoolId(id)
  return poolId(kind, model)
}

/** pool id → last date it was evaluated. */
function lastTested(reports: ScoutReport[]): Record<PoolId, string> {
  const out: Record<PoolId, string> = {}
  for (const r of reports) for (const id of r.candidates ?? []) out[normalize(id)] = r.at
  return out
}

main().catch(err => {
  console.error('[scout] failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
