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

/**
 * The body a destination accepts. Slack incoming webhooks reject anything without `text`
 * (400 "no_text") and Discord needs `content`; everything else (Make, Zapier, a custom endpoint)
 * gets the full event plus a one-line `text` summary.
 */
export function webhookBody(url: string, payload: Record<string, unknown>): Record<string, unknown> {
  const title = typeof payload.title === 'string' ? payload.title : ''
  const body = typeof payload.body === 'string' ? payload.body : ''
  let host = ''
  try { host = new URL(url).hostname.toLowerCase() } catch { /* isBlockedUrl rejects it first */ }
  if (host === 'hooks.slack.com') return { text: body ? `*${title}*\n${body}` : title }
  if ((host === 'discord.com' || host === 'discordapp.com') && new URL(url).pathname.startsWith('/api/webhooks/')) {
    return { content: body ? `**${title}**\n${body}` : title }
  }
  return { text: body ? `${title}: ${body}` : title, ...payload }
}

/**
 * POST an event to a user-configured webhook URL (5s timeout), formatted for its destination.
 * Server-side only: the app's CSP blocks browser connections to other origins, and Slack's
 * webhook endpoint doesn't allow browser (CORS) requests anyway.
 */
export async function sendWebhook(url: string, payload: Record<string, unknown>): Promise<void> {
  if (isBlockedUrl(url)) {
    throw new Error('Webhook URL targets a blocked destination (internal/private network)')
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'RepoHQ/1.0' },
    body: JSON.stringify(webhookBody(url, payload)),
    signal: AbortSignal.timeout(5000),
    redirect: 'manual', // never follow redirects — could redirect to internal network
  })
  if (!res.ok) {
    // Slack answers with a short reason ("no_text", "invalid_token", "channel_not_found").
    let reason = ''
    try { reason = (await res.text()).trim().slice(0, 120) } catch { /* no body */ }
    throw new Error(`Webhook responded ${res.status}${reason ? `: ${reason}` : ''}`)
  }
}
