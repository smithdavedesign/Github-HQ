import { describe, it, expect } from 'vitest'
import { routePattern, cleanMessage } from '../../src/lib/monitoring/error-text'

describe('routePattern', () => {
  it('strips ids and the query', () => {
    expect(routePattern('/repos/12345?tab=prs')).toBe('/repos/:id')
    expect(routePattern('/ideas/botchelor')).toBe('/ideas/botchelor')
    expect(routePattern('')).toBe('/')
  })
})

describe('cleanMessage', () => {
  it('drops anything secret-shaped and keeps the error', () => {
    expect(cleanMessage("Cannot read properties of undefined (reading 'slice')")).toBe("Cannot read properties of undefined (reading 'slice')")
    expect(cleanMessage('connect postgres://u:p@host/db failed')).toBe('connect postgres://… failed')
    expect(cleanMessage('Bearer abc.def rejected')).toBe('Bearer … rejected')
    expect(cleanMessage('token ghp_abcdefghijklmnop bad')).toBe('token ghp_… bad')
  })
})
