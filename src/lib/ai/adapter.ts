import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { decrypt } from '@/lib/crypto-utils'
export type { LLMProvider } from './providers'
export { PROVIDER_LABELS, PROVIDER_MODELS, PROVIDER_KEY_HINTS } from './providers'
import type { LLMProvider } from './providers'
import { PROVIDER_LABELS, PROVIDER_MODELS } from './providers'

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

function createGeminiAdapter(apiKey: string): LLMAdapter {
  return {
    provider: 'gemini',
    async generate({ system, user, fast = false, maxTokens = 1000 }) {
      // Direct REST API — no SDK, no Node.js compatibility issues on Vercel
      const model = fast ? PROVIDER_MODELS.gemini.fast : PROVIDER_MODELS.gemini.capable
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

export async function getLLMAdapter(userId: string): Promise<LLMAdapter> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { llmProvider: true, llmKeys: true, llmApiKey: true },
  })

  const provider = (user?.llmProvider ?? 'anthropic') as LLMProvider
  const keys = (user?.llmKeys ?? {}) as Partial<Record<LLMProvider, string>>

  const envKey =
    provider === 'anthropic' ? process.env.ANTHROPIC_API_KEY :
    provider === 'openai'    ? process.env.OPENAI_API_KEY :
    provider === 'gemini'    ? process.env.GEMINI_API_KEY : null

  // Priority: per-provider key > legacy single key > env var. Both key fields may be
  // AES-GCM encrypted (enc: prefix) or legacy plaintext — decrypt handles both.
  const rawKey = keys[provider] || user?.llmApiKey || null
  const apiKey = rawKey ? decrypt(rawKey) : envKey || null

  if (!apiKey) {
    throw new Error(
      `No API key for ${PROVIDER_LABELS[provider]}. Add one in Settings → AI Provider.`
    )
  }

  if (provider === 'openai') return createOpenAIAdapter(apiKey)
  if (provider === 'gemini') return createGeminiAdapter(apiKey)
  return createAnthropicAdapter(apiKey)
}

export async function testLLMKey(provider: LLMProvider, apiKey: string): Promise<void> {
  let adapter: LLMAdapter
  if (provider === 'openai')      adapter = createOpenAIAdapter(apiKey)
  else if (provider === 'gemini') adapter = createGeminiAdapter(apiKey)
  else                            adapter = createAnthropicAdapter(apiKey)

  await adapter.generate({ system: 'Reply with OK.', user: 'OK?', fast: true, maxTokens: 5 })
}
