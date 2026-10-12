import 'server-only'

/**
 * Stripe MRR for a given user: the cron sync calls it with a userId, so it lives here and not in
 * the 'use server' actions file, where any browser could call it with someone else's id.
 */
import { db } from '@/lib/db'
import { users, repositories } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { encrypt, decrypt } from '@/lib/crypto-utils'

interface StripeSubscriptionPage {
  has_more: boolean
  data: Array<{
    id: string
    items: {
      data: Array<{
        price: { unit_amount: number | null; recurring?: { interval: string }; product: string }
      }>
    }
  }>
}

// Fetch active subscriptions from Stripe and calculate MRR per product
export async function fetchStripeMrr(apiKey: string): Promise<Map<string, { mrr: number; count: number }>> {
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
        const productId = item.price.product
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

/**
 * The user's Stripe key (saved in Settings, encrypted), else STRIPE_API_KEY. A key saved before
 * keys were encrypted is encrypted in place the first time it's read.
 */
export async function resolveStripeKey(userId: string): Promise<string | null> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { stripeApiKey: true },
  })
  const stored = user?.stripeApiKey
  if (!stored) return process.env.STRIPE_API_KEY ?? null
  if (!stored.startsWith('enc:')) {
    await db.update(users).set({ stripeApiKey: encrypt(stored) }).where(eq(users.id, userId))
    return stored
  }
  return decrypt(stored)
}

/** Copy each mapped product's MRR from Stripe onto its repo. */
export async function syncStripeMrrForUser(userId: string): Promise<{ synced: number }> {
  const apiKey = await resolveStripeKey(userId)
  if (!apiKey) return { synced: 0 }

  const mrrByProduct = await fetchStripeMrr(apiKey)

  const mappedRepos = await db.query.repositories.findMany({
    where: eq(repositories.userId, userId),
    columns: { id: true, stripeProductId: true },
  })

  // Batch all updates in parallel — was N sequential DB round-trips
  const toUpdate = mappedRepos
    .filter(r => r.stripeProductId && mrrByProduct.has(r.stripeProductId))
    .map(repo => {
      const data = mrrByProduct.get(repo.stripeProductId!)!
      return {
        id: repo.id,
        mrr: (data.mrr / 100).toFixed(2),
        arr: (data.mrr / 100 * 12).toFixed(2),
      }
    })

  await Promise.all(
    toUpdate.map(({ id, mrr, arr }) =>
      db.update(repositories)
        .set({ mrr, arr, isRevenueGenerating: true })
        .where(eq(repositories.id, id))
    )
  )

  return { synced: toUpdate.length }
}
