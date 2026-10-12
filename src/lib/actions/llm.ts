'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { testLLMKey } from '@/lib/ai/adapter'
import type { LLMProvider } from '@/lib/ai/adapter'
import { PROVIDER_SHORT_NAME, chooseProvider, isPaidProvider, paidAllowed } from '@/lib/ai/providers'
import { encrypt, decrypt } from '@/lib/crypto-utils'

type LLMKeys = Partial<Record<LLMProvider, string>>

export async function getLLMSettings(): Promise<{
  provider: LLMProvider
  hasKey: boolean
  keySource: 'user' | 'env' | null
  savedProviders: LLMProvider[]   // which providers have a key stored in llmKeys
  /** What AI calls actually use (getLLMAdapter's choice): null when no allowed provider has a key. */
  effectiveProvider: LLMProvider | null
  /** LLM_ALLOW_PAID=1: Claude and GPT-4o may run. Off by default (the $0 rule). */
  paidAllowed: boolean
}> {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { llmProvider: true, llmKeys: true },
  })

  const provider = (user?.llmProvider ?? 'openrouter') as LLMProvider
  const keys = (user?.llmKeys ?? {}) as LLMKeys
  const hasUserKey = !!(keys[provider] && keys[provider]!.length > 0)
  const envHas = (p: LLMProvider) => (
    (p === 'anthropic' && !!process.env.ANTHROPIC_API_KEY) ||
    (p === 'openai'    && !!process.env.OPENAI_API_KEY) ||
    (p === 'gemini'    && !!process.env.GEMINI_API_KEY) ||
    (p === 'openrouter' && !!process.env.OPENROUTER_API_KEY)
  )
  const hasEnvKey = envHas(provider)
  const allowPaid = paidAllowed()

  const savedProviders = (Object.entries(keys) as [LLMProvider, string][])
    .filter(([, v]) => v && v.length > 0)
    .map(([k]) => k)

  return {
    provider,
    hasKey: hasUserKey || hasEnvKey,
    keySource: hasUserKey ? 'user' : hasEnvKey ? 'env' : null,
    savedProviders,
    effectiveProvider: chooseProvider(provider, p => !!keys[p] || envHas(p), allowPaid),
    paidAllowed: allowPaid,
  }
}

export async function saveLLMSettings(provider: LLMProvider, apiKey: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  if (isPaidProvider(provider) && !paidAllowed()) throw new Error(`${PROVIDER_SHORT_NAME[provider]} is a paid API and RepoHQ runs at $0. Set LLM_ALLOW_PAID=1 to use it.`)

  // Validate key before touching the DB
  try {
    await testLLMKey(provider, apiKey)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`${PROVIDER_SHORT_NAME[provider]} key invalid: ${msg.slice(0, 200)}`)
  }

  // Fetch current keys, merge in the new one — other providers keep their keys
  const current = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { llmKeys: true },
  })

  const existingKeys = ((current?.llmKeys ?? {}) as LLMKeys)
  const updatedKeys: LLMKeys = { ...existingKeys, [provider]: encrypt(apiKey) }

  const [updated] = await db.update(users)
    .set({ llmProvider: provider, llmKeys: updatedKeys })
    .where(eq(users.id, session.user.id))
    .returning({ id: users.id, llmKeys: users.llmKeys })

  if (!updated) throw new Error('Failed to save — could not find your user account')

  const saved = ((updated.llmKeys ?? {}) as LLMKeys)[provider]
  if (!saved || decrypt(saved) !== apiKey) throw new Error('Key was not persisted correctly — please try again')

  const { revalidatePath } = await import('next/cache')
  revalidatePath('/settings')
}

export async function removeLLMKey() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  // Fetch current keys and clear only the active provider's key
  const current = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { llmProvider: true, llmKeys: true },
  })

  const provider = (current?.llmProvider ?? 'openrouter') as LLMProvider
  const keys = { ...((current?.llmKeys ?? {}) as LLMKeys) }
  delete keys[provider]

  const [updated] = await db.update(users)
    .set({ llmKeys: keys })
    .where(eq(users.id, session.user.id))
    .returning({ id: users.id })

  if (!updated) throw new Error('Failed to remove key — user not found')

  const { revalidatePath } = await import('next/cache')
  revalidatePath('/settings')
}

export async function setLLMProvider(provider: LLMProvider) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  if (isPaidProvider(provider) && !paidAllowed()) throw new Error(`${PROVIDER_SHORT_NAME[provider]} is a paid API and RepoHQ runs at $0. Set LLM_ALLOW_PAID=1 to use it.`)

  // Only update the active provider — NEVER touch llmKeys (other providers keep their keys)
  const [updated] = await db.update(users)
    .set({ llmProvider: provider })
    .where(eq(users.id, session.user.id))
    .returning({ id: users.id })

  if (!updated) throw new Error('Failed to update provider — user not found')

  // Revalidate repo pages so the "Analyze with X" button reflects the new provider
  const { revalidatePath } = await import('next/cache')
  revalidatePath('/repos', 'layout')
}
