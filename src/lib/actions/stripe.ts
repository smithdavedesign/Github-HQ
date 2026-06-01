'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { users, repositories } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { toNum } from '@/lib/utils'

export interface StripeProduct {
  id: string
  name: string
  mrr: number              // calculated monthly recurring revenue
  subscriberCount: number
}

interface StripeSubscriptionPage {
  has_more: boolean
  data: Array<{
    id: string
    items: {
      data: Array<{
        price: { unit_amount: number | null; recurring?: { interval: string } }
        product: string
      }>
    }
  }>
}

// Fetch active subscriptions from Stripe and calculate MRR per product
async function fetchStripeMrr(apiKey: string): Promise<Map<string, { mrr: number; count: number }>> {
  const mrrByProduct = new Map<string, { mrr: number; count: number }>()
  const headers = { 'Authorization': `Bearer ${apiKey}` }

  let cursor: string | null = null
  do {
    const qs = new URLSearchParams({ status: 'active', limit: '100' })
    if (cursor) qs.set('starting_after', cursor)

    const res = await fetch(`https://api.stripe.com/v1/subscriptions?${qs}`, { headers })
    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: { message?: string } }
      throw new Error(`Stripe API error: ${err.error?.message ?? res.statusText}`)
    }

    const page = await res.json() as StripeSubscriptionPage

    for (const sub of page.data) {
      for (const item of sub.items.data) {
        const productId = item.product
        const unitAmount = item.price.unit_amount ?? 0
        const monthly = item.price.recurring?.interval === 'year' ? unitAmount / 12 : unitAmount
        const existing = mrrByProduct.get(productId) ?? { mrr: 0, count: 0 }
        mrrByProduct.set(productId, { mrr: existing.mrr + monthly, count: existing.count + 1 })
      }
    }

    cursor = page.has_more ? (page.data.at(-1)?.id ?? null) : null
  } while (cursor)

  return mrrByProduct
}

async function fetchStripeProducts(apiKey: string, productIds: string[]): Promise<Map<string, string>> {
  const nameById = new Map<string, string>()
  for (const id of productIds) {
    try {
      const res = await fetch(`https://api.stripe.com/v1/products/${id}`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      })
      if (res.ok) {
        const p = await res.json() as { id: string; name: string }
        nameById.set(p.id, p.name)
      }
    } catch { /* skip */ }
  }
  return nameById
}

/** Resolve API key: user's saved key in DB takes priority, falls back to STRIPE_API_KEY env var. */
async function resolveApiKey(userId: string): Promise<string | null> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { stripeApiKey: true },
  })
  return user?.stripeApiKey ?? process.env.STRIPE_API_KEY ?? null
}

export async function saveStripeKey(apiKey: string) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  // Validate the key works before saving
  const res = await fetch('https://api.stripe.com/v1/subscriptions?limit=1', {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  })
  if (!res.ok) throw new Error('Invalid Stripe API key — check it has read access to subscriptions')

  await db.update(users)
    .set({ stripeApiKey: apiKey })
    .where(eq(users.id, session.user.id))
}

export async function removeStripeKey() {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')
  await db.update(users).set({ stripeApiKey: null }).where(eq(users.id, session.user.id))
}

export async function getStripeProducts(): Promise<StripeProduct[]> {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const apiKey = await resolveApiKey(session.user.id)
  if (!apiKey) return []

  const mrrByProduct = await fetchStripeMrr(apiKey)
  const names = await fetchStripeProducts(apiKey, [...mrrByProduct.keys()])

  return [...mrrByProduct.entries()]
    .map(([id, { mrr, count }]) => ({
      id,
      name: names.get(id) ?? id,
      mrr: Math.round(mrr / 100),   // convert cents to dollars
      subscriberCount: count,
    }))
    .sort((a, b) => b.mrr - a.mrr)
}

export async function mapStripeProduct(repoId: number, stripeProductId: string | null) {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  await db.update(repositories)
    .set({ stripeProductId })
    .where(and(eq(repositories.id, repoId), eq(repositories.userId, session.user.id)))
}

export async function syncStripeMrr(): Promise<{ synced: number }> {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const userId = session.user.id
  const apiKey = await resolveApiKey(userId)
  if (!apiKey) return { synced: 0 }

  const mrrByProduct = await fetchStripeMrr(apiKey)

  const mappedRepos = await db.query.repositories.findMany({
    where: and(eq(repositories.userId, userId)),
    columns: { id: true, stripeProductId: true },
  })

  let synced = 0
  for (const repo of mappedRepos) {
    if (!repo.stripeProductId) continue
    const data = mrrByProduct.get(repo.stripeProductId)
    if (data == null) continue

    const mrrDollars = (data.mrr / 100).toFixed(2)
    await db.update(repositories)
      .set({
        mrr: mrrDollars,
        arr: (data.mrr / 100 * 12).toFixed(2),
        isRevenueGenerating: true,
      })
      .where(eq(repositories.id, repo.id))
    synced++
  }

  return { synced }
}

export async function hasStripeKey(): Promise<boolean> {
  const session = await auth()
  if (!session?.user?.id) return false
  const key = await resolveApiKey(session.user.id)
  return !!key
}

export async function stripeKeySource(): Promise<'db' | 'env' | null> {
  const session = await auth()
  if (!session?.user?.id) return null
  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { stripeApiKey: true },
  })
  if (user?.stripeApiKey) return 'db'
  if (process.env.STRIPE_API_KEY) return 'env'
  return null
}
