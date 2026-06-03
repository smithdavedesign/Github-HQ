import { NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Stripe webhook handler — no Stripe SDK.
 * Signature verification uses HMAC-SHA256 via Node.js crypto (same algorithm
 * the SDK uses internally), consistent with the plain-fetch approach elsewhere.
 *
 * Handles subscription lifecycle events:
 * - checkout.session.completed → activate subscription
 * - customer.subscription.updated → plan changes
 * - customer.subscription.deleted → cancellation
 *
 * Required env vars: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
 */

/** Stripe webhook signature verification without the Stripe SDK. */
function verifyStripeSignature(body: string, header: string, secret: string): boolean {
  // header format: t=1714073945,v1=abc123def456,...
  const parts = Object.fromEntries(
    header.split(',').map(p => p.split('=') as [string, string])
  )
  const timestamp = parts['t']
  const v1 = parts['v1']
  if (!timestamp || !v1) return false

  // Reject webhooks older than 5 minutes (replay protection)
  const age = Math.floor(Date.now() / 1000) - parseInt(timestamp, 10)
  if (age > 300) return false

  const payload = `${timestamp}.${body}`
  const expected = createHmac('sha256', secret).update(payload, 'utf8').digest('hex')

  try {
    return timingSafeEqual(Buffer.from(v1, 'hex'), Buffer.from(expected, 'hex'))
  } catch {
    return false
  }
}

interface StripeEvent {
  type: string
  data: { object: Record<string, unknown> }
}

export async function POST(request: Request) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET
  if (!webhookSecret) {
    console.error('[stripe-webhook] STRIPE_WEBHOOK_SECRET not configured')
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 500 })
  }

  const body = await request.text()
  const signature = request.headers.get('stripe-signature')

  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 })
  }

  if (!verifyStripeSignature(body, signature, webhookSecret)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
  }

  let event: StripeEvent
  try {
    event = JSON.parse(body) as StripeEvent
  } catch {
    return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 })
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object
        const userId = (session['metadata'] as Record<string, string> | null)?.['userId']
          ?? session['client_reference_id'] as string | null
        const planId = (session['metadata'] as Record<string, string> | null)?.['planId']
        const customerId = session['customer'] as string | null
        const subscriptionId = session['subscription'] as string | null

        if (userId) {
          console.log(`[stripe-webhook] checkout.session.completed userId=${userId} plan=${planId}`)
          const { db } = await import('@/lib/db')
          const { users } = await import('@/lib/db/schema')
          const { eq } = await import('drizzle-orm')

          await db.update(users).set({
            stripeCustomerId:      customerId ?? undefined,
            stripeSubscriptionId:  subscriptionId ?? undefined,
            stripePlan:            planId ?? 'pro',
            stripeSubscriptionStatus: 'active',
          }).where(eq(users.id, userId))
        }
        break
      }

      case 'customer.subscription.updated': {
        const sub = event.data.object
        const customerId = sub['customer'] as string | null
        const status = sub['status'] as string | null
        if (customerId) {
          console.log(`[stripe-webhook] subscription.updated customer=${customerId} status=${status}`)
          const { db } = await import('@/lib/db')
          const { users } = await import('@/lib/db/schema')
          const { eq } = await import('drizzle-orm')
          await db.update(users).set({ stripeSubscriptionStatus: status ?? undefined })
            .where(eq(users.stripeCustomerId, customerId))
        }
        break
      }

      case 'customer.subscription.deleted': {
        const sub = event.data.object
        const customerId = sub['customer'] as string | null
        if (customerId) {
          console.log(`[stripe-webhook] subscription.deleted customer=${customerId}`)
          const { db } = await import('@/lib/db')
          const { users } = await import('@/lib/db/schema')
          const { eq } = await import('drizzle-orm')
          await db.update(users)
            .set({ stripePlan: 'free', stripeSubscriptionStatus: 'canceled' })
            .where(eq(users.stripeCustomerId, customerId))
        }
        break
      }

      default:
        console.log(`[stripe-webhook] unhandled event: ${event.type}`)
    }

    return NextResponse.json({ received: true })
  } catch (err) {
    console.error('[stripe-webhook] handler error:', err)
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 400 })
  }
}
