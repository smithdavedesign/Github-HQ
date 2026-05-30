import { describe, it, expect, vi, beforeEach } from 'vitest'
import { checkDeploymentUrl } from '@/lib/monitoring/uptime'

describe('checkDeploymentUrl', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns healthy for a fast 200 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    }))

    const result = await checkDeploymentUrl('https://example.com')
    expect(result.status).toBe('healthy')
    expect(result.httpStatus).toBe(200)
    expect(result.sslValid).toBe(true)
    expect(result.responseTimeMs).toBeGreaterThanOrEqual(0)
  })

  it('returns down for a 500 response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    }))

    const result = await checkDeploymentUrl('https://example.com')
    expect(result.status).toBe('down')
    expect(result.httpStatus).toBe(500)
  })

  it('returns down when fetch throws (network error / timeout)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')))

    const result = await checkDeploymentUrl('https://example.com')
    expect(result.status).toBe('down')
    expect(result.responseTimeMs).toBeNull()
    expect(result.httpStatus).toBeNull()
  })

  it('sets sslValid true for https URLs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }))
    const result = await checkDeploymentUrl('https://example.com')
    expect(result.sslValid).toBe(true)
  })

  it('sets sslValid false for http URLs', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }))
    const result = await checkDeploymentUrl('http://example.com')
    expect(result.sslValid).toBe(false)
  })
})
