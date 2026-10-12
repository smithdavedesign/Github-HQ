import { describe, it, expect } from 'vitest'
import { AGENT_TABS, parseAgentTab } from '@/lib/agents/agent-tabs'

describe('Agents page tabs', () => {
  it('are Now, Runs, Requests, KPIs and Log, in that order', () => {
    expect(AGENT_TABS.map(t => t.label)).toEqual(['Now', 'Runs', 'Requests', 'KPIs', 'Log'])
  })
  it('read ?tab= and fall back to Now', () => {
    expect(parseAgentTab('log')).toBe('log')
    expect(parseAgentTab(['kpis', 'x'])).toBe('kpis')
    expect(parseAgentTab('nope')).toBe('now')
    expect(parseAgentTab(undefined)).toBe('now')
  })
})
