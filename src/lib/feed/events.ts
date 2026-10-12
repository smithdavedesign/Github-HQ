/**
 * The Portfolio Feed says what happened, newest first. Standing alert counts live on the Security
 * page; here an alert appears once, as "new", in the two weeks after GitHub raised it. Pure.
 */

export const NEW_ALERT_DAYS = 14

export interface AlertRow { severity: string; title: string; createdAt: Date | null }

/** One "new alerts" entry for a repo, or null when nothing critical or high appeared recently. */
export function newAlertsEntry(findings: AlertRow[], now = new Date()) {
  const since = now.getTime() - NEW_ALERT_DAYS * 86_400_000
  const fresh = findings
    .filter(f => (f.severity === 'critical' || f.severity === 'high') && f.createdAt && f.createdAt.getTime() >= since)
    .sort((a, b) => b.createdAt!.getTime() - a.createdAt!.getTime())
  if (!fresh.length) return null
  const critical = fresh.some(f => f.severity === 'critical')
  return {
    type: critical ? 'security_critical' as const : 'security_high' as const,
    description: `${fresh.length} new ${critical ? 'critical or high' : 'high-severity'} alert${fresh.length > 1 ? 's' : ''}`,
    detail: fresh[0].title,
    severity: critical ? 'critical' as const : 'warning' as const,
    date: fresh[0].createdAt!,
  }
}

/** Newest first. Severity colours an entry but doesn't pin it (pinning kept 7-year-old alerts above this week's merges). */
export function newestFirst<T extends { date: Date }>(events: T[]): T[] {
  return [...events].sort((a, b) => b.date.getTime() - a.date.getTime())
}
