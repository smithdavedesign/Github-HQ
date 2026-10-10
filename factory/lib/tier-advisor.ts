/**
 * Tier advisor: a local model rates how hard a coding task is, 1–3, so routing can start at the right
 * model instead of always climbing from the cheapest. One rater for every caller: the factory's tasks,
 * owner requests, and idea milestone builds (idea-factory, through `npm run factory:rate`).
 *
 *   1 routine   lint, dependency bumps, docs, one-file fixes              → local (M0)
 *   2 moderate  bugs, failing tests, type errors, small features          → free pool (M1)
 *   3 advanced  features across files, PRD milestones, architecture        → strongest (Copilot MC / paid M2; Claude for ideas)
 *
 * It advises; it doesn't decide alone. Capability "tier-advisor" (factory.config.json):
 *   report  ratings are logged next to outcomes and scored (exact / too high / too low)
 *   pr      routing starts at the advised tier (within what the task is allowed)
 * It's promoted like every other capability, on evidence. Fallback is never the advisor's call:
 * escalation and capacity fallbacks stay deterministic rules.
 *
 * The rater runs on a local model, so it may read private repos and work data.
 */
import type { ModelTier } from '../../src/lib/agents/model-router'
import { TIER_ORDER } from '../../src/lib/agents/model-router'
import type { LedgerEntry } from './ledger'

export type Difficulty = 1 | 2 | 3

export interface Rating { difficulty: Difficulty; reason: string; source: 'model' | 'rule'; model?: string }

/** The fallback when the model can't answer: what each known task kind usually is. */
export const RULE_DIFFICULTY: Record<string, Difficulty> = {
  'lint-autofix': 1, 'deps-audit': 1, 'docs-readme': 1, 'fix-lint': 1,
  'fix-types': 2, 'fix-tests': 2, 'red-ci': 2, 'owner-report': 2,
  'owner-requested': 2, 'idea-milestone': 3,
}

/** Preferred starting tier per difficulty, cheapest that's usually enough. */
export const PREFERRED: Record<Difficulty, ModelTier[]> = { 1: ['M0', 'M1'], 2: ['M1', 'M0'], 3: ['MC', 'M2', 'M1'] }

export interface RateInput { kind: string; title: string; objective: string; files?: string[]; repo?: string }

export function ratingPrompt(t: RateInput): string {
  return [
    'Rate how hard this coding task is for an AI coding agent. Answer with JSON only: {"tier": 1|2|3, "reason": "one short sentence"}.',
    '1 = routine: lint, dependency bumps, docs, a one-file mechanical fix.',
    '2 = moderate: a bug, failing tests, type errors, a small feature in a few files.',
    '3 = advanced: a feature across many files, building a milestone from a product spec, architecture, anything needing design judgment.',
    'Rate the work, not its importance. When unsure between two, pick the higher.',
    '',
    `Kind: ${t.kind}`,
    t.repo ? `Repo: ${t.repo}` : '',
    `Title: ${t.title}`,
    `Task: ${t.objective.slice(0, 4000)}`,
    t.files?.length ? `Files in scope (${t.files.length}): ${t.files.slice(0, 15).join(', ')}` : '',
  ].filter(Boolean).join('\n')
}

/** Read {"tier":n,"reason":…} (or "tier: n") from a model reply; null if there's no valid tier. */
export function parseRating(text: string): { difficulty: Difficulty; reason: string } | null {
  const body = String(text ?? '').replace(/<think>[\s\S]*?<\/think>/g, '')
  const json = body.match(/\{[\s\S]*?\}/)
  if (json) {
    try {
      const o = JSON.parse(json[0]) as { tier?: unknown; reason?: unknown }
      const n = Number(o.tier)
      if (n === 1 || n === 2 || n === 3) return { difficulty: n, reason: String(o.reason ?? '').slice(0, 200) }
    } catch { /* fall through to the loose form */ }
  }
  const loose = body.match(/tier["'\s:=]*([123])\b/i)
  return loose ? { difficulty: Number(loose[1]) as Difficulty, reason: body.replace(/\s+/g, ' ').trim().slice(0, 200) } : null
}

/** The tier to start at: the first preferred tier the task is allowed; else the cheapest allowed. */
export function advisedTier(difficulty: Difficulty, allowed: ModelTier[]): ModelTier | null {
  return PREFERRED[difficulty].find(t => allowed.includes(t)) ?? TIER_ORDER.find(t => allowed.includes(t)) ?? null
}

export interface AdvisorConfig { litellm: { url: string; key: string }; advisor: { model: string; timeoutMs: number } }

/** Ask the local model; fall back to the kind's usual difficulty. Never throws. */
export async function rateTask(cfg: AdvisorConfig, t: RateInput, fetchImpl: typeof fetch = fetch): Promise<Rating> {
  const rule: Rating = { difficulty: RULE_DIFFICULTY[t.kind] ?? 2, reason: `usual difficulty for ${t.kind}`, source: 'rule' }
  try {
    const res = await fetchImpl(`${cfg.litellm.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.litellm.key}` },
      body: JSON.stringify({
        model: cfg.advisor.model, temperature: 0, max_tokens: 200,
        // Local thinking models (qwen3) answer straight away with this.
        ...(cfg.advisor.model.startsWith('local-') ? { reasoning_effort: 'none' } : {}),
        messages: [{ role: 'user', content: ratingPrompt(t) }],
      }),
      signal: AbortSignal.timeout(cfg.advisor.timeoutMs),
    })
    if (!res.ok) return rule
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const parsed = parseRating(body.choices?.[0]?.message?.content ?? '')
    return parsed ? { ...parsed, source: 'model', model: cfg.advisor.model } : rule
  } catch {
    return rule
  }
}

// ─── Evidence: was the advice right? ────────────────────────────────────────

export interface TierAdviceEntry {
  type: 'tier_advice'
  at: string
  runId: string
  repo: string
  kind: string
  title: string
  difficulty: Difficulty
  source: 'model' | 'rule'
  reason: string
  advisedTier: ModelTier | null
  routedTier: ModelTier | null
  acted: boolean
}

export interface AdviceScore { judged: number; exact: number; tooHigh: number; tooLow: number }

/**
 * Score each advice against what happened in its run: the lowest tier that produced a verified fix.
 * exact = advised that tier; tooHigh = advised a stronger one (worked, but spent a scarcer model);
 * tooLow = advised a weaker one (it would have failed first). Runs with no verified fix aren't judged.
 * Only tiers that were actually tried count, so it's evidence, not proof.
 */
export function scoreAdvice(entries: LedgerEntry[]): AdviceScore {
  const idx = (t: ModelTier) => TIER_ORDER.indexOf(t)
  const score: AdviceScore = { judged: 0, exact: 0, tooHigh: 0, tooLow: 0 }
  for (const a of entries.filter((e): e is TierAdviceEntry => e.type === 'tier_advice')) {
    if (!a.advisedTier) continue
    const verified = entries.filter((e): e is Extract<LedgerEntry, { type: 'attempt' }> =>
      e.type === 'attempt' && e.runId === a.runId && e.repo === a.repo && e.kind === a.kind && e.outcome === 'verified')
    if (!verified.length) continue
    const lowest = verified.map(v => v.tier).sort((x, y) => idx(x) - idx(y))[0]!
    score.judged++
    if (idx(a.advisedTier) === idx(lowest)) score.exact++
    else if (idx(a.advisedTier) > idx(lowest)) score.tooHigh++
    else score.tooLow++
  }
  return score
}

export const ADVISOR_MIN_JUDGED = 10
/** Promote when ≥ 80% of judged advice was exact or too high (safe) and ≥ 50% exact; demote above 30% too low. */
export function advisorReady(s: AdviceScore): 'promote' | 'demote' | 'hold' {
  if (s.judged < ADVISOR_MIN_JUDGED) return 'hold'
  if (s.tooLow / s.judged > 0.3) return 'demote'
  return (s.exact + s.tooHigh) / s.judged >= 0.8 && s.exact / s.judged >= 0.5 ? 'promote' : 'hold'
}

/** Idea builds: which engine goes first. Claude first by default; a routine milestone may start free once acting. */
export function ideaEngineOrder(difficulty: Difficulty | null, mode: 'report' | 'act'): Array<'claude' | 'free'> {
  return mode === 'act' && difficulty === 1 ? ['free', 'claude'] : ['claude', 'free']
}
