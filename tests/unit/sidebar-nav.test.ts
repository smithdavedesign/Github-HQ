import { describe, expect, it } from 'vitest'
import { MORE_NAV, PRIMARY_NAV, isNavActive } from '../../src/components/layout/nav-items'
import { factoryStatus } from '../../src/lib/health/factory-status'

describe('sidebar navigation', () => {
  it('leads with the four primary pages; Triage and Graveyard are reached from Repositories', () => {
    expect(PRIMARY_NAV.map(i => i.label)).toEqual(['Dashboard', 'Repositories', 'Agents', 'Security'])
    expect(MORE_NAV.map(i => i.label)).toEqual(['Deployments', 'Analytics', 'Feed'])
    expect([...PRIMARY_NAV, ...MORE_NAV].some(i => /triage|graveyard/i.test(i.href))).toBe(false)
  })
  it('highlights Repositories on its sub-pages, and Dashboard only on /', () => {
    expect(isNavActive('/repos/graveyard', '/repos')).toBe(true)
    expect(isNavActive('/repos/12', '/repos')).toBe(true)
    expect(isNavActive('/repository', '/repos')).toBe(false)
    expect(isNavActive('/security', '/')).toBe(false)
    expect(isNavActive('/', '/')).toBe(true)
  })
})

describe('factory status dot', () => {
  const now = new Date('2026-10-08T12:00:00Z')
  const h = (n: number) => new Date(now.getTime() - n * 3_600_000)
  it('running when a cycle or request finished within 36 h', () => {
    expect(factoryStatus({ firstRunAt: h(100), lastWorkAt: h(2), skipReason: null }, now).state).toBe('running')
  })
  it('idle after 36 h, with the skip reason in the detail', () => {
    const s = factoryStatus({ firstRunAt: h(100), lastWorkAt: h(40), skipReason: 'on battery power' }, now)
    expect(s).toMatchObject({ state: 'idle', label: 'Factory idle 40 h' })
    expect(s.detail).toMatch(/on battery power/)
  })
  it('paused when the newest skipped run says so, and not set up before the first run', () => {
    expect(factoryStatus({ firstRunAt: h(100), lastWorkAt: h(1), skipReason: 'paused (~/.repohq-factory/PAUSE)' }, now).state).toBe('paused')
    expect(factoryStatus({ firstRunAt: null, lastWorkAt: null, skipReason: null }, now).state).toBe('not-set-up')
  })
})
