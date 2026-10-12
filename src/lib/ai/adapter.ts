import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { decrypt } from '@/lib/crypto-utils'
export type { LLMProvider } from './providers'
export { PROVIDER_LABELS, PROVIDER_MODELS, PROVIDER_KEY_HINTS } from './providers'
import type { LLMProvider } from './providers'
import { PROVIDER_MODELS, FREE_PROVIDERS, NO_FREE_PROVIDER, chooseProvider, paidAllowed } from './providers'

export interface GenerateParams {
  system: string
  user: string
  fast?: boolean        // true = haiku / gpt-4o-mini / gemini-flash  false = sonnet / gpt-4o / gemini-pro
  maxTokens?: number
  cacheSystem?: boolean // prompt caching — Claude only, silently ignored for others
}

export interface LLMAdapter {
  provider: LLMProvider
  generate(params: GenerateParams): Promise<string>
}

// Lazy imports — each SDK is loaded only when that provider is actually used.
// This prevents a broken Gemini or OpenAI SDK from crashing the whole module
// and taking down Claude/other providers with it.

function createAnthropicAdapter(apiKey: string): LLMAdapter {
  return {
    provider: 'anthropic',
    async generate({ system, user, fast = false, maxTokens = 1000, cacheSystem = false }) {
      const Anthropic = (await import('@anthropic-ai/sdk')).default
      const client = new Anthropic({ apiKey })
      const model = fast ? PROVIDER_MODELS.anthropic.fast : PROVIDER_MODELS.anthropic.capable
      const message = await client.messages.create({
        model,
        max_tokens: maxTokens,
        system: cacheSystem
          ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
          : system,
        messages: [{ role: 'user', content: user }],
      })
      return message.content[0].type === 'text' ? message.content[0].text.trim() : '{}'
    },
  }
}

function createOpenAIAdapter(apiKey: string): LLMAdapter {
  return {
    provider: 'openai',
    async generate({ system, user, fast = false, maxTokens = 1000 }) {
      const OpenAI = (await import('openai')).default
      const client = new OpenAI({ apiKey })
      const model = fast ? PROVIDER_MODELS.openai.fast : PROVIDER_MODELS.openai.capable
      const response = await client.chat.completions.create({
        model,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user',   content: user },
        ],
      })
      return response.choices[0].message.content?.trim() ?? '{}'
    },
  }
}

function createOpenRouterAdapter(apiKey: string): LLMAdapter {
  return {
    provider: 'openrouter',
    async generate({ system, user, fast = false, maxTokens = 1000 }) {
      const OpenAI = (await import('openai')).default
      // OPENROUTER_BASE_URL lets local dev point this at the LiteLLM gateway (http://localhost:4000/v1).
      const client = new OpenAI({ apiKey, baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1' })
      const model = fast
        ? process.env.OPENROUTER_MODEL_FAST || PROVIDER_MODELS.openrouter.fast
        : process.env.OPENROUTER_MODEL_CAPABLE || PROVIDER_MODELS.openrouter.capable
      const response = await client.chat.completions.create({
        model,
        max_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user',   content: user },
        ],
      })
      return response.choices[0]?.message.content?.trim() ?? '{}'
    },
  }
}

function createGeminiAdapter(apiKey: string): LLMAdapter {
  return {
    provider: 'gemini',
    async generate({ system, user, fast = false, maxTokens = 1000 }) {
      // Direct REST API — no SDK, no Node.js compatibility issues on Vercel
      const model = fast
        ? process.env.GEMINI_MODEL_FAST || PROVIDER_MODELS.gemini.fast
        : process.env.GEMINI_MODEL_CAPABLE || PROVIDER_MODELS.gemini.capable
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`

      const body = {
        contents: [{ role: 'user', parts: [{ text: user }] }],
        systemInstruction: { parts: [{ text: system }] },
        generationConfig: { maxOutputTokens: maxTokens },
      }

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
        throw new Error(err.error?.message ?? `Gemini API error: ${res.status} ${res.statusText}`)
      }

      const data = await res.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
      }
      return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? '{}'
    },
  }
}

/** The server's own key for a provider, if any. */
function envKeyFor(provider: LLMProvider): string | null {
  return (
    provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY :
    provider === 'openai'    ? process.env.OPENAI_API_KEY :
    provider === 'gemini'    ? process.env.GEMINI_API_KEY :
    provider === 'openrouter' ? process.env.OPENROUTER_API_KEY : null
  ) || null
}

export async function getLLMAdapter(userId: string): Promise<LLMAdapter> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { llmProvider: true, llmKeys: true, llmApiKey: true },
  })

  const chosen = (user?.llmProvider ?? 'openrouter') as LLMProvider
  const keys = (user?.llmKeys ?? {}) as Partial<Record<LLMProvider, string>>

  // Priority per provider: the user's key > the legacy single key (the chosen provider's) > env var.
  // Both key fields may be AES-GCM encrypted (enc: prefix) or legacy plaintext — decrypt handles both.
  const keyFor = (p: LLMProvider): string | null => {
    const raw = keys[p] || (p === chosen ? user?.llmApiKey : null) || null
    return raw ? decrypt(raw) : envKeyFor(p)
  }

  // Paid providers only with LLM_ALLOW_PAID=1; otherwise the first free provider with a key.
  const provider = chooseProvider(chosen, p => !!keyFor(p), paidAllowed())
  if (!provider) throw new Error(NO_FREE_PROVIDER)
  return createAdapter(provider, keyFor(provider)!)
}

function createAdapter(provider: LLMProvider, apiKey: string): LLMAdapter {
  if (provider === 'openai')     return createOpenAIAdapter(apiKey)
  if (provider === 'gemini')     return createGeminiAdapter(apiKey)
  if (provider === 'openrouter') return createOpenRouterAdapter(apiKey)
  return createAnthropicAdapter(apiKey)
}

/**
 * Fallback for structured-output calls when the primary model returns unusable JSON twice: the
 * other free provider the server has a key for, or Claude Haiku when paid providers are allowed.
 * Null when there's nothing else to try.
 */
export function getFallbackAdapter(primary: LLMProvider): LLMAdapter | null {
  if (paidAllowed() && primary !== 'anthropic' && process.env.ANTHROPIC_API_KEY) return createAnthropicAdapter(process.env.ANTHROPIC_API_KEY)
  const other = FREE_PROVIDERS.find(p => p !== primary && envKeyFor(p))
  return other ? createAdapter(other, envKeyFor(other)!) : null
}

export async function testLLMKey(provider: LLMProvider, apiKey: string): Promise<void> {
  const adapter = createAdapter(provider, apiKey)
  await adapter.generate({ system: 'Reply with OK.', user: 'OK?', fast: true, maxTokens: 5 })
}
