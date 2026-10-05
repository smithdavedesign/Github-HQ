/**
 * Model scout (Phase 64) — weekly, $0.
 *
 *   npx tsx factory/scout.ts            # evaluate candidates, update free-agent / free-agent-b
 *   npx tsx factory/scout.ts --dry-run  # evaluate only; leave aliases unchanged
 *
 * 1. Lists free, tool-calling models on OpenRouter.
 * 2. Exposes up to 6 candidates (plus incumbents) as scout-N aliases in LiteLLM.
 * 3. Runs the eval suite (factory/eval) through Claude Code on each.
 * 4. Points free-agent / free-agent-b at the two best, keeps local-agent on Ollama,
 *    removes the scout-N aliases, and commits the change in ~/ai-stack.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { loadConfig } from './lib/config'
import { EVAL_CASES, runEval, type EvalOutcome } from './lib/evals'
import { appendEntry } from './lib/ledger'
import { readManagedModels, type ManagedModel } from './lib/litellm-config'
import { applyLiteLLMModels, commitStackConfig } from './lib/litellm-ops'
import { historicalOutcomes, isFreeToolModel, pickAliases, rankModels, selectCandidates, type OpenRouterModel } from './lib/scout-select'
import { recordScout } from './lib/sink'
import { freeQuota, SCOUT_REQUESTS_PER_CASE } from './lib/quota'
import { acquireLock } from './lib/lock'

const LOCAL_AGENT: ManagedModel = { name: 'local-agent', model: 'qwen2.5:7b-coding', kind: 'ollama', numCtx: 16384 }

const log = (...a: unknown[]) => console.log(`[scout ${new Date().toISOString().slice(11, 19)}]`, ...a)

async function main() {
  const dryRun = process.argv.includes('--dry-run')
  const limit = Number(process.argv.find(a => a.startsWith('--limit='))?.split('=')[1] ?? 6)
  const cfg = loadConfig()
  acquireLock(cfg.home, 'scout')

  const configText = readFileSync(cfg.litellm.configPath, 'utf8')
  const current = readManagedModels(configText)
  // First run: the hand-configured cloud-or model is the incumbent, so a scout
  // that can't evaluate anything (quota) still leaves a working free-agent.
  const cloudOr = /model_name: cloud-or\n\s+litellm_params:\n\s+model: openrouter\/(\S+)/.exec(configText)?.[1]
  const incumbents = { primary: current['free-agent'] ?? cloudOr, backup: current['free-agent-b'] }

  const res = await fetch('https://openrouter.ai/api/v1/models')
  if (!res.ok) throw new Error(`OpenRouter models API → ${res.status}`)
  const models = ((await res.json()) as { data: OpenRouterModel[] }).data
  const reportDir = path.join(cfg.home, 'scout-reports')
  const history = historicalOutcomes(readReports(reportDir), new Set(models.filter(isFreeToolModel).map(m => m.id)), new Date())

  const quota = await freeQuota(cfg)
  const budgetCases = quota ? Math.floor(quota.remaining / SCOUT_REQUESTS_PER_CASE) : Infinity
  if (quota) log(`OpenRouter free quota: ${quota.remaining}/${quota.limit} requests left today (~${budgetCases} eval cases)`)
  if (budgetCases < EVAL_CASES.length) {
    log('not enough free quota to evaluate today — choosing from recent scout history')
    const pick = pickAliases(rankModels(history.filter(o => !o.rateLimited && o.case !== 'preflight')), incumbents)
    log('pick:', pick)
    if (!dryRun && (pick.primary !== current['free-agent'] || pick.backup !== current['free-agent-b'])) {
      await applyLiteLLMModels(cfg, liveModels(pick), liveFallbacks(pick))
      await commitStackConfig(cfg, `factory scout (from history): free-agent=${pick.primary} free-agent-b=${pick.backup}`)
    }
    return
  }
  const affordableModels = Math.max(1, Math.floor(budgetCases / EVAL_CASES.length))

  const candidates = selectCandidates(models, [incumbents.primary, incumbents.backup].filter((x): x is string => !!x), Math.min(limit, affordableModels), lastTested(reportDir))
  log(`${candidates.length} candidates:`, candidates.join(', '))
  if (candidates.length === 0) throw new Error('no free tool-calling candidates found')

  // Keep the live aliases working while candidates are evaluated.
  const live = liveModels(incumbents)
  const scoutAliases = candidates.map((model, i) => ({ name: `scout-${i + 1}`, model, kind: 'openrouter' as const }))
  await applyLiteLLMModels(cfg, [...live, ...scoutAliases], liveFallbacks(incumbents))
  log('LiteLLM reloaded with scout aliases')

  const outcomes: EvalOutcome[] = []
  evaluation: for (const alias of scoutAliases) {
    const pre = await preflight(cfg.litellm.url, cfg.litellm.key, alias.name)
    if (pre !== 'ok') {
      log(`${alias.model.padEnd(48)} skipped — preflight ${pre}`)
      outcomes.push({ model: alias.model, case: 'preflight', pass: false, detail: pre, durationMs: 0, rateLimited: pre === 'rate_limited' })
      continue
    }
    for (const c of EVAL_CASES) {
      const o = await runEval(c, alias.name, 'M1', cfg)
      outcomes.push({ ...o, model: alias.model })
      log(`${alias.model.padEnd(48)} ${c.name.padEnd(17)} ${o.pass ? 'PASS' : 'fail'} ${(o.durationMs / 1000).toFixed(0)}s ${o.detail}`)
      if (o.rateLimited) {
        // Shared free pools throttle per model: stop spending time on this one today.
        log(`${alias.model} rate limited — skipping its remaining cases`)
        break
      }
      const q = await freeQuota(cfg)
      if (q && q.remaining < SCOUT_REQUESTS_PER_CASE) {
        log(`free quota nearly exhausted (${q.remaining} left) — stopping evaluation`)
        break evaluation
      }
    }
  }

  // Rate-limited cases say nothing about skill; pickAliases needs ≥ 2 completed cases.
  // Today's results are ranked together with recent history (see historicalOutcomes).
  const scores = rankModels([...history, ...outcomes].filter(o => !o.rateLimited && o.case !== 'preflight'))
  const pick = pickAliases(scores, incumbents)
  log('ranking:', scores.map(s => `${s.model} ${s.passes}/${s.total} ~${Math.round(s.avgMs / 1000)}s`).join(' | '))
  log('pick:', pick)

  const finalModels = liveModels(pick)
  const target = dryRun ? live : finalModels
  await applyLiteLLMModels(cfg, target, liveFallbacks(dryRun ? incumbents : pick))
  if (!dryRun && (pick.primary !== incumbents.primary || pick.backup !== incumbents.backup)) {
    await commitStackConfig(cfg, `factory scout: free-agent=${pick.primary} free-agent-b=${pick.backup}`)
  }

  const at = new Date().toISOString()
  mkdirSync(reportDir, { recursive: true })
  writeFileSync(path.join(reportDir, `${at.slice(0, 19).replace(/:/g, '')}.json`), JSON.stringify({ at, dryRun, candidates, outcomes, scores, pick }, null, 2))
  appendEntry(cfg.home, { type: 'scout', at, primary: pick.primary, backup: pick.backup, scores })
  await recordScout(cfg, { primary: pick.primary, backup: pick.backup, scores, dryRun })
  log(dryRun ? 'dry run — aliases unchanged' : 'aliases updated')
}

/** One tiny completion through LiteLLM — catches upstream throttling before a 5-minute eval does. */
async function preflight(url: string, key: string, alias: string): Promise<'ok' | 'rate_limited' | string> {
  try {
    const r = await fetch(`${url}/v1/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: alias, messages: [{ role: 'user', content: 'Reply with OK.' }], max_tokens: 16 }),
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

/** model id → last date it was evaluated, from previous scout reports. */
function lastTested(reportDir: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const r of readReports(reportDir)) for (const id of r.candidates ?? []) out[id] = r.at
  return out
}

function liveModels(p: { primary?: string | null; backup?: string | null }): ManagedModel[] {
  return [
    ...(p.primary ? [{ name: 'free-agent', model: p.primary, kind: 'openrouter' as const }] : []),
    ...(p.backup ? [{ name: 'free-agent-b', model: p.backup, kind: 'openrouter' as const }] : []),
    LOCAL_AGENT,
  ]
}

function liveFallbacks(p: { primary?: string | null; backup?: string | null }): Record<string, string[]> {
  // Free-only: free-agent falls back to free-agent-b; local-agent never escalates on its own.
  return p.primary && p.backup ? { 'free-agent': ['free-agent-b'] } : {}
}

main().catch(err => {
  console.error('[scout] failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
