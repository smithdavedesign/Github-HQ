/**
 * Pure candidate selection + ranking for the model scout (Phase 64).
 */

export interface OpenRouterModel {
  id: string
  context_length?: number
  pricing?: { prompt?: string; completion?: string }
  supported_parameters?: string[]
}

/** Providers excluded from candidacy: meta-routers are non-deterministic; stealth models train on prompts. */
const EXCLUDE = [/^openrouter\//, /^stealth\//, /^liquid\//]
const CODING_HINT = /cod(e|er)|laguna|devstral|qwen|nemotron|gemma|deepseek|glm|kimi/i

export function isFreeToolModel(m: OpenRouterModel): boolean {
  return m.pricing?.prompt === '0' && m.pricing?.completion === '0' && (m.supported_parameters ?? []).includes('tools')
}

/**
 * Up to `limit` free, tool-calling candidates. Incumbents (current aliases)
 * are always re-tested so a model that degraded or vanished gets replaced; the
 * rest rotate (never-tested first, then least recently tested) so every free
 * model gets evaluated over a few weeks despite the per-run cap.
 */
export function selectCandidates(
  models: OpenRouterModel[],
  incumbents: string[],
  limit = 6,
  /** model id → ISO date it was last evaluated; untested and stale models rotate in first. */
  lastTested: Record<string, string> = {},
): string[] {
  const available = new Set(models.filter(isFreeToolModel).map(m => m.id))
  const keep = incumbents.filter(id => available.has(id))
  const ranked = models
    .filter(isFreeToolModel)
    .filter(m => !EXCLUDE.some(re => re.test(m.id)))
    .filter(m => (m.context_length ?? 0) >= 64_000)
    .filter(m => !keep.includes(m.id))
    .map(m => ({ id: m.id, score: (CODING_HINT.test(m.id) ? 2 : 0) + ((m.context_length ?? 0) >= 200_000 ? 1 : 0) }))
    .sort((a, b) => (lastTested[a.id] ?? '').localeCompare(lastTested[b.id] ?? '') || b.score - a.score || a.id.localeCompare(b.id))
    .map(m => m.id)
  return [...keep, ...ranked].slice(0, Math.max(limit, keep.length))
}

export interface CaseResult {
  model: string
  pass: boolean
  durationMs: number
}

export interface ModelScore {
  model: string
  passes: number
  total: number
  avgMs: number
}

/** Rank by passes, then speed. */
export function rankModels(results: CaseResult[]): ModelScore[] {
  const by = new Map<string, CaseResult[]>()
  for (const r of results) by.set(r.model, [...(by.get(r.model) ?? []), r])
  return [...by.entries()]
    .map(([model, rs]) => ({
      model,
      passes: rs.filter(r => r.pass).length,
      total: rs.length,
      avgMs: Math.round(rs.reduce((s, r) => s + r.durationMs, 0) / rs.length),
    }))
    .sort((a, b) => b.passes - a.passes || a.avgMs - b.avgMs)
}

/**
 * Best two models clearing the bar (≥ minCases completed, ≥ minPassRate). Falls
 * back to incumbents rather than shipping a worse alias — or no alias at all.
 */
export function pickAliases(
  scores: ModelScore[],
  incumbents: { primary?: string; backup?: string },
  minPassRate = 2 / 3,
  minCases = 2,
): { primary: string | null; backup: string | null } {
  const qualified = scores.filter(s => s.total >= minCases && s.passes / s.total >= minPassRate).map(s => s.model)
  const primary = qualified[0] ?? incumbents.primary ?? null
  // A displaced primary is demoted to backup rather than dropped.
  const backupPool = [...qualified.slice(1), incumbents.primary, incumbents.backup, ...qualified]
  const backup = backupPool.find((m): m is string => !!m && m !== primary) ?? null
  return { primary, backup }
}

export interface HistoricalOutcome extends CaseResult {
  case: string
  rateLimited: boolean
  at: string
}

/**
 * Outcomes from earlier scout reports within the window, limited to models still
 * offered for free. With ~50 free requests/day the scout can only evaluate a
 * couple of models per run, so evidence accumulates across runs.
 */
export function historicalOutcomes(
  reports: { at: string; outcomes?: { model: string; case: string; pass: boolean; durationMs: number; rateLimited: boolean }[] }[],
  available: Set<string>,
  now: Date,
  windowDays = 21,
): HistoricalOutcome[] {
  const since = now.getTime() - windowDays * 86_400_000
  return reports
    .filter(r => new Date(r.at).getTime() >= since)
    .flatMap(r => (r.outcomes ?? []).map(o => ({ ...o, at: r.at })))
    .filter(o => available.has(o.model))
}
