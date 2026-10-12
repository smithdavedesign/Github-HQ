import { describe, it, expect } from 'vitest'
import { dockerAvailableConfirmed } from '../../factory/lib/sandbox'

describe('dockerAvailableConfirmed', () => {
  const probes = (...results: boolean[]) => {
    let calls = 0
    const probe = async () => results[Math.min(calls++, results.length - 1)]
    return { probe, calls: () => calls }
  }
  it('up on the first probe: one call', async () => {
    const p = probes(true)
    expect(await dockerAvailableConfirmed(p.probe)).toBe(true)
    expect(p.calls()).toBe(1)
  })
  it('one missed probe (busy Mac) is retried and still counts as up', async () => {
    const p = probes(false, true)
    expect(await dockerAvailableConfirmed(p.probe)).toBe(true)
    expect(p.calls()).toBe(2)
  })
  it('down only when two probes agree', async () => {
    const p = probes(false, false)
    expect(await dockerAvailableConfirmed(p.probe)).toBe(false)
    expect(p.calls()).toBe(2)
  })
})
