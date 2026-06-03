import { NextResponse } from 'next/server'

/**
 * Stripe webhook handler.
 *
 * Handles subscription lifecycle events:
 * - checkout.session.completed → activate subscription
 * - customer.subscription.updated → plan changes
 * - customer.subscription.deleted → cancellation
 *
 * Requires STRIPE_WEBHOOK_SECRET env var for signature verification.
 */
export async function POST(request: Request) {
  const stripeSecretKey = process.env.STRIPE_SECRET_KEY
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET

  if (!stripeSecretKey || !webhookSecret) {
    console.error('[stripe-webhook] Missing STRIPE_SECRET_KEY or STRIPE_WEBHOOK_SECRET')
    return NextResponse.json({ error: 'Stripe not configured' }, { status: 500 })
  }

  const body = await request.text()
  const signature = request.headers.get('stripe-signature')

  if (!signature) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 })
  }

  try {
    const Stripe = (await import('stripe')).default
    const stripe = new Stripe(stripeSecretKey)

    const event = stripe.webhooks.constructEvent(body, signature, webhookSecret)

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object
        const userId = session.metadata?.userId ?? session.client_reference_id
        const planId = session.metadata?.planId
        const customerId = typeof session.customer === 'string' ? session.customer : session.customer?.toString()
        const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.toString()

        if (userId) {
          console.log(
            `[stripe-webhook] checkout.session.completed: userId=${userId} plan=${planId} customer=${customerId} subscription=${subscriptionId}`,
          )

          // Update user record with subscription info
          // Uses dynamic import to keep the webhook handler lean
          const { db } = await import('@/lib/db')
          const { users } = await import('@/lib/db/schema')
          const { eq } = await import('drizzle-orm')

          await db
            .update(users)
            .set({
              stripeCustomerId: customerId ?? undefined,
              stripeSubscriptionId: subscriptionId ?? undefined,
              stripePlan: planId ?? 'pro',
            })
            .where(eq(users.id, userId))
        }
        break
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object
        const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.toString()
        console.log(`[stripe-webhook] subscription.updated: customer=${customerId} status=${subscription.status}`)

        if (customerId) {
          const { db } = await import('@/lib/db')
          const { users } = await import('@/lib/db/schema')
          const { eq } = await import('drizzle-orm')

          await db
            .update(users)
            .set({
              stripeSubscriptionStatus: subscription.status,
            })
            .where(eq(users.stripeCustomerId, customerId))
        }
        break
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object
        const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer?.toString()
        console.log(`[stripe-webhook] subscription.deleted: customer=${customerId}`)

        if (customerId) {
          const { db } = await import('@/lib/db')
          const { users } = await import('@/lib/db/schema')
          const { eq } = await import('drizzle-orm')

          await db
            .update(users)
            .set({
              stripePlan: 'free',
              stripeSubscriptionStatus: 'canceled',
            })
            .where(eq(users.stripeCustomerId, customerId))
        }
        break
      }

      default:
        console.log(`[stripe-webhook] Unhandled event: ${event.type}`)
    }

    return NextResponse.json({ received: true })
  } catch (err) {
    console.error('[stripe-webhook] Error:', err)
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 400 },
    )
  }
}
