'use server'

import { auth } from '@/lib/auth'
import { db } from '@/lib/db'
import { notifications, users } from '@/lib/db/schema'
import { eq, and, isNull, desc, isNotNull } from 'drizzle-orm'

export async function getUnreadNotifications(limit = 20) {
  const session = await auth()
  if (!session?.user?.id) return []

  return db.query.notifications.findMany({
    where: and(
      eq(notifications.userId, session.user.id),
      isNull(notifications.readAt),
    ),
    orderBy: [desc(notifications.createdAt)],
    limit,
    with: { repository: { columns: { name: true, id: true } } },
  })
}

export async function getUnreadCount(): Promise<number> {
  const session = await auth()
  if (!session?.user?.id) return 0

  const rows = await db.query.notifications.findMany({
    where: and(
      eq(notifications.userId, session.user.id),
      isNull(notifications.readAt),
    ),
    columns: { id: true },
  })
  return rows.length
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
    webhookUrl: user?.notificationWebhookUrl ?? '',
    healthAlertThreshold: user?.healthAlertThreshold ?? 55,
  }
}

export async function saveNotificationSettings(webhookUrl: string, healthAlertThreshold: number): Promise<void> {
  const session = await auth()
  if (!session?.user?.id) throw new Error('Unauthorized')

  const threshold = Math.min(100, Math.max(0, Math.round(healthAlertThreshold)))
  const url = webhookUrl.trim()
  if (url) {
    try { new URL(url) } catch { throw new Error('Webhook URL is not a valid URL') }
  }

  await db
    .update(users)
    .set({
      notificationWebhookUrl: url || null,
      healthAlertThreshold: threshold,
    })
    .where(eq(users.id, session.user.id))
}
