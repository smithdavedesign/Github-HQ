'use server'

import { db } from '@/lib/db'
import { notifications, users, repositories } from '@/lib/db/schema'
import { eq, and, gte } from 'drizzle-orm'
import { sendWebhook } from './webhook'

export type NotificationEventType =
  | 'health_alert'
  | 'agent_pr_ready'
  | 'agent_pr_merged'
  | 'agent_failed'
  | 'security_critical'

interface DispatchParams {
  userId: string
  eventType: NotificationEventType
  title: string
  body?: string
  repoId?: number | null
  metadata?: Record<string, unknown>
}

/**
 * Creates an in-app notification and fires the user's configured webhook (if any).
 * Never throws — notification failures must not break the caller.
 */
export async function dispatchNotification(params: DispatchParams): Promise<void> {
  try {
    await db.insert(notifications).values({
      userId: params.userId,
      repoId: params.repoId ?? null,
      eventType: params.eventType,
      title: params.title,
      body: params.body ?? null,
      metadata: params.metadata ?? null,
    })
  } catch (err) {
    console.warn('[notifications] insert failed:', err instanceof Error ? err.message : err)
    return
  }

  // Fire user's webhook if configured
  try {
    const user = await db.query.users.findFirst({
      where: eq(users.id, params.userId),
      columns: { notificationWebhookUrl: true },
    })
    if (user?.notificationWebhookUrl) {
      await sendWebhook(user.notificationWebhookUrl, {
        eventType: params.eventType,
        title: params.title,
        body: params.body,
        repoId: params.repoId,
        metadata: params.metadata,
        timestamp: new Date().toISOString(),
      })
    }
  } catch (err) {
    console.warn('[notifications] webhook failed:', err instanceof Error ? err.message : err)
  }
}


/**
 * Check all repos for this user against their healthAlertThreshold.
 * Creates a health_alert notification for each repo below threshold
 * that hasn't been notified in the last 7 days.
 */
export async function checkHealthThresholdAlerts(userId: string): Promise<number> {
  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { healthAlertThreshold: true },
  })
  const threshold = user?.healthAlertThreshold ?? 55

  const userRepos = await db.query.repositories.findMany({
    where: eq(repositories.userId, userId),
    with: { metrics: { columns: { healthScore: true } } },
    columns: { id: true, name: true },
  })

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000)

  // Find existing recent health alerts to avoid spam
  const recentAlerts = await db.query.notifications.findMany({
    where: and(
      eq(notifications.userId, userId),
      eq(notifications.eventType, 'health_alert'),
      gte(notifications.createdAt, sevenDaysAgo),
    ),
    columns: { repoId: true },
  })
  const recentlyAlertedRepoIds = new Set(recentAlerts.map(n => n.repoId).filter(Boolean))

  let dispatched = 0
  for (const repo of userRepos) {
    const health = repo.metrics?.healthScore
    if (health == null || health >= threshold) continue
    if (recentlyAlertedRepoIds.has(repo.id)) continue

    await dispatchNotification({
      userId,
      eventType: 'health_alert',
      title: `${repo.name} health dropped to ${Math.round(health)}`,
      body: `Health score is below your ${threshold}-point threshold.`,
      repoId: repo.id,
      metadata: { healthScore: Math.round(health), threshold },
    })
    dispatched++
  }

  return dispatched
}
