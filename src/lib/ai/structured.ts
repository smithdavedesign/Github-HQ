import type { GenerateParams, LLMAdapter } from './adapter'
import { isTransientAiError } from './errors'

/**
 * Structured-output guard (Phase 62).
 *
 * Free models are noticeably worse at "return only JSON": they wrap it in
 * prose, ```json fences, or <think> reasoning blocks. Every structured call goes
 * through generateJson(): extract → validate → one repair retry → optional
 * fallback adapter (Claude Haiku). A provider error (429/503) skips straight to the
 * fallback. Pure except for the adapter calls.
 */

/** Pull the first complete JSON object/array out of a model response. Throws if none. */
export function extractJson(text: string): unknown {
  const cleaned = text
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/```(?:json)?/gi, '')
    .trim()

  try {
    return JSON.parse(cleaned)
  } catch {
    // fall through to scanning for an embedded object/array
  }

  for (let start = 0; start < cleaned.length; start++) {
    const open = cleaned[start]
    if (open !== '{' && open !== '[') continue
    const end = findMatchingBracket(cleaned, start)
    if (end === -1) continue
    try {
      return JSON.parse(cleaned.slice(start, end + 1))
    } catch {
      // keep scanning
    }
  }
  throw new Error('no JSON object found in model response')
}

/** Index of the bracket closing the one at `start`, respecting strings; -1 if unbalanced. */
function findMatchingBracket(s: string, start: number): number {
  const stack: string[] = []
  let inString = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (inString) {
      if (c === '\\') i++
      else if (c === '"') inString = false
      continue
    }
    if (c === '"') inString = true
    else if (c === '{') stack.push('}')
    else if (c === '[') stack.push(']')
    else if (c === '}' || c === ']') {
      if (stack.pop() !== c) return -1
      if (stack.length === 0) return i
    }
  }
  return -1
}

export interface StructuredResult<T> {
  value: T
  /** 1 = first try, 2 = after repair, 3 = fallback adapter, 4 = one more try after a busy provider. */
  attempts: number
  usedFallback: boolean
}

/**
 * Validator: return the typed value or throw with a message the model can act on.
 * The default accepts any JSON object/array.
 */
export type Validator<T> = (value: unknown) => T

const defaultValidator = <T>(value: unknown): T => {
  if (value === null || typeof value !== 'object') throw new Error('expected a JSON object or array')
  return value as T
}

export async function generateJson<T>(
  adapter: LLMAdapter,
  params: GenerateParams,
  options: { validate?: Validator<T>; fallback?: LLMAdapter | null; label?: string; retryDelayMs?: number } = {},
): Promise<StructuredResult<T>> {
  const validate = options.validate ?? defaultValidator<T>
  const label = options.label ?? 'structured'
  const retryDelayMs = options.retryDelayMs ?? 5_000

  const tryParse = (text: string): T => validate(extractJson(text))

  // Provider errors (429 quota, 503 overloaded) go straight to the fallback: a free tier being busy
  // must not fail the advisor or digest. When the fallback is busy too, or there is none, the busy one
  // gets one more try a few seconds later: on 2026-10-13 Gemini's "high demand" failed the digest and
  // the Advisor, and the weekly digest went unwritten.
  const afterProviderError = async (err: unknown): Promise<StructuredResult<T>> => {
    let fallbackErr: unknown = null
    if (options.fallback) {
      console.warn(`[${label}] ${adapter.provider} failed (${err instanceof Error ? err.message.slice(0, 120) : err}); falling back to ${options.fallback.provider}`)
      let fb: string | null = null
      try { fb = await options.fallback.generate({ ...params, fast: true }) } catch (e) { fallbackErr = e }
      if (fb !== null) return { value: tryParse(fb), attempts: 3, usedFallback: true }
    }
    const retry = isTransientAiError(err) ? adapter : options.fallback && isTransientAiError(fallbackErr) ? options.fallback : null
    if (!retry) throw fallbackErr ?? err
    console.warn(`[${label}] ${retry.provider} is busy; one more try in ${retryDelayMs / 1000}s`)
    await new Promise(res => setTimeout(res, retryDelayMs))
    const again = await retry.generate(retry === adapter ? params : { ...params, fast: true })
    return { value: tryParse(again), attempts: 4, usedFallback: retry !== adapter }
  }

  let first: string
  try {
    first = await adapter.generate(params)
  } catch (err) {
    return afterProviderError(err)
  }
  try {
    return { value: tryParse(first), attempts: 1, usedFallback: false }
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    console.warn(`[${label}] invalid JSON from ${adapter.provider} (${reason}); repairing`)

    const repaired = await adapter.generate({
      ...params,
      user: `${params.user}\n\n---\nYour previous reply could not be used: ${reason}.\nReply again with ONLY the JSON value — no prose, no markdown fences, no reasoning.`,
    })
    try {
      return { value: tryParse(repaired), attempts: 2, usedFallback: false }
    } catch (err2) {
      if (!options.fallback) throw err2
      console.warn(`[${label}] repair failed on ${adapter.provider}; falling back to ${options.fallback.provider}`)
      const fb = await options.fallback.generate({ ...params, fast: true })
      return { value: tryParse(fb), attempts: 3, usedFallback: true }
    }
  }
}
