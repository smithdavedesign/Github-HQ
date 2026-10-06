import path from 'node:path'
import type { FactoryConfig } from './config'
import { readEnvVar } from './config'
import { OLLAMA_CLOUD_BASE, poolId, type PoolId } from './litellm-config'
import { pickGeminiCandidates } from './scout-select'

/**
 * Candidate discovery for the free model pool. Keys come from the stack's
 * litellm/.env at runtime and only ever go into request headers/URLs.
 */

export function stackKey(cfg: FactoryConfig, name: string, env: NodeJS.ProcessEnv = process.env): string | null {
  return env[name] || readEnvVar(path.join(path.dirname(cfg.litellm.configPath), '.env'), name)
}

/**
 * Gemini Flash models that answer right now on this key (Google AI Studio free tier).
 * The `-latest` pointers come first (they track the current Flash), then the newest
 * versioned Flash models. Each is probed: on the free tier the newest models often
 * return 503 "high demand", and retired ones 404.
 */
export async function discoverGemini(cfg: FactoryConfig, limit = 2): Promise<PoolId[]> {
  const key = stackKey(cfg, 'GEMINI_API_KEY')
  if (!key) return []
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${key}`, { signal: AbortSignal.timeout(20_000) })
    if (!r.ok) return []
    const j = (await r.json()) as { models?: { name: string; supportedGenerationMethods?: string[] }[] }
    const names = (j.models ?? []).filter(m => m.supportedGenerationMethods?.includes('generateContent')).map(m => m.name.replace(/^models\//, ''))
    const ordered = [...['gemini-flash-latest', 'gemini-flash-lite-latest'].filter(n => names.includes(n)), ...pickGeminiCandidates(names, 6)]
    const found: PoolId[] = []
    for (const model of ordered) {
      if (found.length >= limit) break
      if (await geminiAnswers(key, model)) found.push(poolId('gemini', model))
    }
    return found
  } catch {
    return []
  }
}

async function geminiAnswers(key: string, model: string): Promise<boolean> {
  try {
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: 'Reply with OK' }] }] }),
      signal: AbortSignal.timeout(60_000),
    })
    return r.ok
  } catch {
    return false
  }
}

/** Probe order: coding models first, then the largest. */
function ollamaPriority(name: string): number {
  if (/cod(e|er)/i.test(name)) return 0
  if (/120b|ultra|super|675b|480b|pro/i.test(name)) return 1
  if (/gemma|gpt-oss/i.test(name)) return 2
  return 3
}

/**
 * Ollama Cloud models usable on this account's plan *with tool calling*.
 * Many cloud models are Pro-only; one tiny tool-call probe per model settles it.
 */
export async function discoverOllamaCloud(cfg: FactoryConfig, limit = 2, exclude: string[] = []): Promise<PoolId[]> {
  const key = stackKey(cfg, 'OLLAMA_API_KEY')
  if (!key) return []
  let names: string[] = []
  try {
    const r = await fetch('https://ollama.com/api/tags', { signal: AbortSignal.timeout(20_000) })
    names = r.ok ? ((await r.json()) as { models?: { name: string }[] }).models?.map(m => m.name) ?? [] : []
  } catch {
    return []
  }
  const found: PoolId[] = []
  for (const name of names.filter(n => !exclude.includes(poolId('ollama-cloud', n))).sort((a, b) => ollamaPriority(a) - ollamaPriority(b))) {
    if (found.length >= limit) break
    if (await ollamaCloudToolCall(key, name)) found.push(poolId('ollama-cloud', name))
  }
  return found
}

async function ollamaCloudToolCall(key: string, model: string): Promise<boolean> {
  try {
    const r = await fetch(`${OLLAMA_CLOUD_BASE}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(90_000),
      body: JSON.stringify({
        model,
        max_tokens: 200,
        messages: [{ role: 'user', content: 'What is the weather in Paris? Use the tool.' }],
        tools: [{ type: 'function', function: { name: 'get_weather', description: 'Get weather', parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } } }],
      }),
    })
    if (!r.ok) return false
    const j = (await r.json()) as { choices?: { message?: { tool_calls?: unknown[] } }[] }
    return (j.choices?.[0]?.message?.tool_calls?.length ?? 0) > 0
  } catch {
    return false
  }
}
