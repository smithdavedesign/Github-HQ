/**
 * Whether a model reply or a stored row has the Advisor's shape (pure). On 2026-10-19 a reply parsed as
 * JSON but had no headline or actions; it was saved as `{ generatedAt }` and the dashboard crashed on
 * `advisor.actions.slice`.
 */
export function hasAdvisorShape(value: unknown): value is { headline: string; actions: unknown[] } {
  if (!value || typeof value !== 'object') return false
  const v = value as { headline?: unknown; actions?: unknown }
  return typeof v.headline === 'string' && Array.isArray(v.actions)
}
