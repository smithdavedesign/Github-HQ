/**
 * Pure webhook sender — no DB imports, safe to unit test.
 */

/**
 * Blocks requests to internal/private network destinations to prevent SSRF.
 * Covers: loopback, link-local, private IPv4 ranges, and common cloud metadata endpoints.
 */
export function isBlockedUrl(rawUrl: string): boolean {
  let parsed: URL
  try { parsed = new URL(rawUrl) } catch { return true }

  const hostname = parsed.hostname.toLowerCase()

  // Block non-HTTP(S) schemes
  if (!['http:', 'https:'].includes(parsed.protocol)) return true

  // Loopback
  if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') return true

  // Cloud metadata endpoints
  if (hostname === '169.254.169.254' || hostname === 'metadata.google.internal') return true

  // Private IPv4 ranges
  const ipv4 = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/)
  if (ipv4) {
    const [, a, b] = ipv4.map(Number)
    if (a === 10) return true                          // 10.0.0.0/8
    if (a === 172 && b >= 16 && b <= 31) return true   // 172.16.0.0/12
    if (a === 192 && b === 168) return true             // 192.168.0.0/16
    if (a === 127) return true                          // 127.0.0.0/8 (full range)
    if (a === 169 && b === 254) return true             // 169.254.0.0/16 link-local
  }

  return false
}

/** POST a JSON payload to a user-configured webhook URL (5s timeout). */
export async function sendWebhook(url: string, payload: Record<string, unknown>): Promise<void> {
  if (isBlockedUrl(url)) {
    throw new Error('Webhook URL targets a blocked destination (internal/private network)')
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'RepoHQ/1.0' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000),
    redirect: 'manual', // never follow redirects — could redirect to internal network
  })
  if (!res.ok) {
    throw new Error(`Webhook responded ${res.status}`)
  }
}
