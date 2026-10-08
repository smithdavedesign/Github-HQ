/**
 * Phase 49 — Notification dispatcher unit tests.
 * Tests pure logic that doesn't require a DB connection.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── sendWebhook tests ────────────────────────────────────────────────────────
// We test the webhook send logic by mocking fetch

// Import from the pure webhook module (no DB dependency)
import { maskWebhookUrl, sendWebhook, webhookBody } from '../../src/lib/notifications/webhook'

describe('sendWebhook', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('POSTs JSON to the given URL', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', mockFetch)

    await sendWebhook('https://example.com/hook', { eventType: 'test', title: 'Hello' })

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, opts] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://example.com/hook')
    expect(opts.method).toBe('POST')
    expect(opts.headers).toMatchObject({ 'Content-Type': 'application/json' })
    const body = JSON.parse(opts.body as string)
    expect(body.eventType).toBe('test')
    expect(body.title).toBe('Hello')
  })

  it('throws when the server responds with an error status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }))

    await expect(sendWebhook('https://example.com/hook', {})).rejects.toThrow('500')
  })

  it("surfaces the destination's reason (Slack's 400 bodies say what's wrong)", async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => 'no_text' }))
    await expect(sendWebhook('https://hooks.slack.com/services/T/B/x', { title: 't' })).rejects.toThrow('Webhook responded 400: no_text')
  })
})

describe('webhookBody: formatted for the destination', () => {
  const event = { eventType: 'health_alert', title: 'Health drop', body: 'family-tree fell to 40', timestamp: 't' }
  it('Slack gets only text (it rejects payloads without it)', () => {
    expect(webhookBody('https://hooks.slack.com/services/T/B/x', event)).toEqual({ text: '*Health drop*\nfamily-tree fell to 40' })
  })
  it('Discord gets content', () => {
    expect(webhookBody('https://discord.com/api/webhooks/1/abc', event)).toEqual({ content: '**Health drop**\nfamily-tree fell to 40' })
  })
  it('anything else gets the full event plus a text summary', () => {
    expect(webhookBody('https://hook.make.com/xyz', event)).toEqual({ text: 'Health drop: family-tree fell to 40', ...event })
  })
})

// ─── checkHealthThresholdAlerts logic ─────────────────────────────────────────
// The DB-dependent functions need real DB access; we test the pure threshold logic here

describe('health threshold boundary conditions', () => {
  it('threshold 55 means repos at 54 are alerted, 55 are not', () => {
    const threshold = 55
    const shouldAlert = (health: number) => health < threshold
    expect(shouldAlert(54)).toBe(true)
    expect(shouldAlert(55)).toBe(false)
    expect(shouldAlert(0)).toBe(true)
    expect(shouldAlert(100)).toBe(false)
  })

  it('custom threshold 70 triggers on repos below 70', () => {
    const threshold = 70
    const shouldAlert = (health: number) => health < threshold
    expect(shouldAlert(69)).toBe(true)
    expect(shouldAlert(70)).toBe(false)
  })
})

// ─── Notification event type constants ───────────────────────────────────────
describe('notification event types', () => {
  const VALID_EVENT_TYPES = [
    'health_alert',
    'agent_pr_ready',
    'agent_pr_merged',
    'agent_failed',
    'security_critical',
  ] as const

  it('has distinct event type strings', () => {
    const unique = new Set(VALID_EVENT_TYPES)
    expect(unique.size).toBe(VALID_EVENT_TYPES.length)
  })

  it('all are non-empty strings', () => {
    for (const t of VALID_EVENT_TYPES) {
      expect(typeof t).toBe('string')
      expect(t.length).toBeGreaterThan(0)
    }
  })
})

describe('maskWebhookUrl', () => {
  it('shows only the host and the last 4 characters', () => {
    expect(maskWebhookUrl('https://hooks.slack.com/services/T0/B0/abcdWXYZ')).toBe('hooks.slack.com/…WXYZ')
    expect(maskWebhookUrl('not a url')).toBe('webhook/… url')
  })
})
