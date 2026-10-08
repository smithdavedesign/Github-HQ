'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { notifications, users } from '@/lib/db/schema'
import { eq, and, isNull, desc, isNotNull } from 'drizzle-orm'
import { maskWebhookUrl, sendWebhook } from '@/lib/notifications/webhook'

export async function getUnreadNotifications(limit = 20) {
  const session = await auth()
  if (!session?.user?.id) return []

  try {
    return await db.query.notifications.findMany({
      where: and(
        eq(notifications.userId, session.user.id),
        isNull(notifications.readAt),
      ),
      orderBy: [desc(notifications.createdAt)],
      limit,
      with: { repository: { columns: { name: true, id: true } } },
    })
  } catch (err) {
    console.warn('[notifications/getUnread]', err instanceof Error ? err.message : err)
    return []
  }
}

export async function getUnreadCount(): Promise<number> {
  const session = await auth()
  if (!session?.user?.id) return 0

  try {
    const rows = await db.query.notifications.findMany({
      where: and(
        eq(notifications.userId, session.user.id),
        isNull(notifications.readAt),
      ),
      columns: { id: true },
    })
    return rows.length
  } catch {
    return 0
  }
}

export async function markAllNotificationsRead(): Promise<void> {
  const session = await auth()
  if (!session?.user?.id) return

  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(
      eq(notifications.userId, session.user.id),
      isNull(notifications.readAt),
    ))
}

export async function markNotificationRead(notificationId: number): Promise<void> {
  const session = await auth()
  if (!session?.user?.id) return

  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(
      eq(notifications.id, notificationId),
      eq(notifications.userId, session.user.id),
    ))
}

export async function getNotificationSettings() {
  const session = await auth()
  if (!session?.user?.id) return null

  const user = await db.query.users.findFirst({
    where: eq(users.id, session.user.id),
    columns: { notificationWebhookUrl: true, healthAlertThreshold: true },
  })
  return {
    // Masked: the saved URL is a credential and is never sent back to the browser.
    webhookHint: user?.notificationWebhookUrl ? maskWebhookUrl(user.notificationWebhookUrl) : null,
    healthAlertThreshold: user?.healthAlertThreshold ?? 55,
  }
}

/**
 * Send a test event from the server (the browser can't: CSP, and Slack has no CORS). An empty
 * `webhookUrl` tests the saved one, which the browser never sees.
 */
export async function testNotificationWebhook(webhookUrl = ''): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await auth()
  if (!session?.user?.id) return { ok: false, error: 'Unauthorized' }
  let url = webhookUrl.trim()
  if (!url) {
    const saved = await db.query.users.findFirst({ where: eq(users.id, session.user.id), columns: { notificationWebhookUrl: true } })
    url = saved?.notificationWebhookUrl ?? ''
    if (!url) return { ok: false, error: 'Enter a webhook URL first' }
  }
  try { new URL(url) } catch { return { ok: false, error: 'Webhook URL is not a valid URL' } }
  try {
    await sendWebhook(url, {
      eventType: 'test',
      title: 'RepoHQ webhook test',
      body: 'If you see this, your webhook is working.',
      timestamp: new Date().toISOString(),
    })
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Webhook failed' }
  }
}

/** `webhookUrl`: null keeps the saved URL, '' removes it, anything else replaces it. */
export async function saveNotificationSettings(webhookUrl: string | null, healthAlertThreshold: number): Promise<void> {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const threshold = Math.min(100, Math.max(0, Math.round(healthAlertThreshold)))
  const url = webhookUrl?.trim() ?? null
  if (url) {
    try { new URL(url) } catch { throw new Error('Webhook URL is not a valid URL') }
  }

  await db
    .update(users)
    .set({
      ...(url === null ? {} : { notificationWebhookUrl: url || null }),
      healthAlertThreshold: threshold,
    })
    .where(eq(users.id, session.user.id))
}
