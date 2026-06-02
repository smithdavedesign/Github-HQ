/**
 * Shared cron/webhook auth guard.
 * Fail-secure: returns false if the secret env var is unset, so an unconfigured
 * environment can never accidentally accept requests.
 */

export function verifyCronSecret(request: Request): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  return request.headers.get('authorization') === `Bearer ${expected}`
}
