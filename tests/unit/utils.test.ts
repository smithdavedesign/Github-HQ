import { describe, it, expect, vi, afterEach } from 'vitest'
import { formatDistanceToNow } from '@/lib/utils'

describe('formatDistanceToNow', () => {
  afterEach(() => vi.useRealTimers())

  it('returns just now for very recent dates', () => {
    const now = new Date()
    expect(formatDistanceToNow(now)).toBe('just now')
  })

  it('returns minutes for dates less than 1 hour ago', () => {
    const date = new Date(Date.now() - 30 * 60 * 1000) // 30 min ago
    expect(formatDistanceToNow(date)).toBe('30m ago')
  })

  it('returns hours for dates less than 1 day ago', () => {
    const date = new Date(Date.now() - 3 * 60 * 60 * 1000) // 3 hours ago
    expect(formatDistanceToNow(date)).toBe('3h ago')
  })

  it('returns days for dates less than 30 days ago', () => {
    const date = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000) // 5 days ago
    expect(formatDistanceToNow(date)).toBe('5d ago')
  })

  it('returns months for dates less than 1 year ago', () => {
    const date = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) // 60 days ago
    expect(formatDistanceToNow(date)).toBe('2mo ago')
  })

  it('returns years for old dates', () => {
    const date = new Date(Date.now() - 400 * 24 * 60 * 60 * 1000) // ~400 days ago
    expect(formatDistanceToNow(date)).toBe('1y ago')
  })

  it('handles null gracefully', () => {
    expect(formatDistanceToNow(null)).toBe('—')
  })

  it('accepts string dates', () => {
    const date = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
    expect(formatDistanceToNow(date)).toBe('2h ago')
  })
})
