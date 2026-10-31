import { describe, it, expect } from 'vitest'
import { dockerAvailableConfirmed, ensureDocker } from '../../factory/lib/sandbox'

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

describe('ensureDocker', () => {
  const ok = { code: 0, output: '' }
  const noSleep = async () => {}
  it('up already: nothing started', async () => {
    const calls: string[] = []
    const r = await ensureDocker({ probe: async () => true, exec: (async (cmd: string, args: string[]) => { calls.push([cmd, ...args].join(' ')); return ok }) as never, sleep: noSleep })
    expect(r).toEqual({ ok: true, started: false })
    expect(calls).toEqual([])
  })
  it('down: starts Docker Desktop and waits for the engine', async () => {
    const calls: string[] = []
    let up = false
    const r = await ensureDocker({
      probe: async () => up,
      exec: (async (cmd: string, args: string[]) => { calls.push([cmd, ...args].join(' ')); up = true; return ok }) as never,
      sleep: noSleep, pollMs: 1, waitMs: 10,
    })
    expect(r).toEqual({ ok: true, started: true })
    expect(calls).toEqual(['docker desktop start --detach'])
  })
  it('falls back to open -a Docker, and reports an engine that never answers', async () => {
    const calls: string[] = []
    const r = await ensureDocker({
      probe: async () => false,
      exec: (async (cmd: string, args: string[]) => { calls.push([cmd, ...args].join(' ')); return cmd === 'docker' ? { code: 1, output: '' } : ok }) as never,
      sleep: noSleep, pollMs: 1, waitMs: 3,
    })
    expect(r).toEqual({ ok: false, started: true })
    expect(calls).toEqual(['docker desktop start --detach', 'open -a Docker'])
  })
})
