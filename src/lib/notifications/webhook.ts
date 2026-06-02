/**
 * Pure webhook sender — no DB imports, safe to unit test.
 */

/** POST a JSON payload to a user-configured webhook URL (5s timeout). */
export async function sendWebhook(url: string, payload: Record<string, unknown>): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'RepoHQ/1.0' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000),
  })
  if (!res.ok) {
    throw new Error(`Webhook responded ${res.status}`)
  }
}
