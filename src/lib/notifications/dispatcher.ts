import 'server-only'

import { db } from '@/lib/db'
import { notifications, users, repositories } from '@/lib/db/schema'
import { eq, and, gte, isNull, desc } from 'drizzle-orm'
import { sendWebhook } from './webhook'
import { repeatKey } from '@/lib/feed/collapse'
import { shouldAlertHealth } from './health-alert-policy'

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
    // The same agent failure retried all day produced hundreds of identical unread notifications
    // (and webhook pings). Skip it while an unread copy from the last 24h is still in the bell.
    if (params.eventType === 'agent_failed') {
      const since = new Date(Date.now() - 86_400_000)
      const recent = await db.query.notifications.findMany({
        where: and(
          eq(notifications.userId, params.userId),
          eq(notifications.eventType, 'agent_failed'),
          isNull(notifications.readAt),
          gte(notifications.createdAt, since),
        ),
        columns: { repoId: true, title: true, body: true },
        limit: 200,
      })
      const key = repeatKey(params.repoId, params.title, params.body)
      if (recent.some(n => repeatKey(n.repoId, n.title, n.body) === key)) return
    }
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
 * Creates a health_alert notification for each active repo that newly falls below the
 * threshold, or falls further after an alert (health-alert-policy.ts).
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
    columns: { id: true, name: true, isArchived: true, lifecycleStatus: true },
  })

  // Score at each repo's latest health alert (newest first, so the first one seen wins).
  const pastAlerts = await db.query.notifications.findMany({
    where: and(eq(notifications.userId, userId), eq(notifications.eventType, 'health_alert')),
    columns: { repoId: true, metadata: true },
    orderBy: [desc(notifications.createdAt)],
  })
  const lastAlertedScore = new Map<number, number | null>()
  for (const n of pastAlerts) {
    if (n.repoId == null || lastAlertedScore.has(n.repoId)) continue
    const score = (n.metadata as { healthScore?: number } | null)?.healthScore
    lastAlertedScore.set(n.repoId, typeof score === 'number' ? score : 0)
  }

  let dispatched = 0
  for (const repo of userRepos) {
    const health = repo.metrics?.healthScore
    const retired = !!repo.isArchived || repo.lifecycleStatus === 'archived' || repo.lifecycleStatus === 'sunsetting'
    if (!shouldAlertHealth({ health, threshold, lastAlertedScore: lastAlertedScore.get(repo.id) ?? null, retired })) continue

    await dispatchNotification({
      userId,
      eventType: 'health_alert',
      title: `${repo.name} health dropped to ${Math.round(health!)}`,
      body: `Health score is below your ${threshold}-point threshold.`,
      repoId: repo.id,
      metadata: { healthScore: Math.round(health!), threshold },
    })
    dispatched++
  }

  return dispatched
}
