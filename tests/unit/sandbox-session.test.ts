import { describe, it, expect } from 'vitest'
import { createSession, type SessionSandbox } from '../../factory/bin/sandbox-session'
import type { ProcOptions } from '../../factory/lib/proc'

/** A fake sandbox that records what the session asks of it. */
function fakeSandbox() {
  const calls: { cmd: string; args: string[]; opts?: ProcOptions }[] = []
  const state = { copied: '', patchedFrom: '', closed: 0 }
  const sb: SessionSandbox = {
    run: async (cmd, args, opts) => {
      calls.push({ cmd, args, opts })
      if (cmd === 'git' && args[0] === 'rev-parse') return { code: 0, output: 'abc1234def\n', durationMs: 1, timedOut: false }
      return { code: 0, output: `ran ${cmd}`, durationMs: 5, timedOut: false }
    },
    copyIn: async dir => { state.copied = dir },
    exportPatch: async (base, file) => { state.patchedFrom = `${base}->${file}` },
    close: async () => { state.closed++ },
  }
  return { sb, calls, state }
}

describe('sandbox session (idea builds in the factory sandbox)', () => {
  it('opens with the extra hosts and models, copies the clone in, and remembers its HEAD', async () => {
    const f = fakeSandbox()
    let opened: unknown = null
    const s = createSession({ open: async o => { opened = o; return f.sb }, tmpDir: () => '/tmp/x', log: () => {} })
    const r = await s.handle({ id: 1, op: 'open', dir: '/work/dawnlog', allowHosts: ['api.anthropic.com', 3], allowModels: ['free-agent'] })
    expect(r).toEqual({ id: 1, ok: true, workdir: '/workspace', relayUrl: 'http://egress:4000', modelKey: 'sk-repohq-sandbox' })
    expect(opened).toEqual({ allowHosts: ['api.anthropic.com'], allowModels: ['free-agent'] })
    const g = fakeSandbox()
    let long: unknown = null
    const s2 = createSession({ open: async o => { long = o; return g.sb }, tmpDir: () => '/tmp/x', log: () => {} })
    await s2.handle({ op: 'open', dir: '/w', lifetimeMs: 99 * 3_600_000 })
    expect(long).toEqual({ allowHosts: [], allowModels: [], lifetimeMs: 8 * 3_600_000 })
    expect(f.state.copied).toBe('/work/dawnlog')
    expect((await s.handle({ id: 2, op: 'open', dir: '/work/x' })).error).toMatch(/already open/)
  })

  it('exec passes only the given env (valid names, string values) and a long output limit', async () => {
    const f = fakeSandbox()
    const s = createSession({ open: async () => f.sb, tmpDir: () => '/tmp/x', log: () => {} })
    await s.handle({ op: 'open', dir: '/w' })
    const r = await s.handle({ id: 3, op: 'exec', cmd: 'claude', args: ['-p', 'x'], env: { CLAUDE_CODE_OAUTH_TOKEN: 't', 'bad name': 'x', N: 5 }, timeoutMs: 1000 })
    expect(r).toMatchObject({ id: 3, ok: true, code: 0, output: 'ran claude' })
    const call = f.calls.find(c => c.cmd === 'claude')!
    expect(call.opts).toMatchObject({ env: { CLAUDE_CODE_OAUTH_TOKEN: 't' }, cwd: '/workspace', timeoutMs: 1000, maxOutput: 50_000_000 })
    expect(Object.keys(call.opts!.env!)).toEqual(['CLAUDE_CODE_OAUTH_TOKEN'])
  })

  it('put writes outside the workspace; patch commits everything but node_modules and diffs from the base', async () => {
    const f = fakeSandbox()
    const s = createSession({ open: async () => f.sb, tmpDir: () => '/tmp/x', log: () => {} })
    await s.handle({ op: 'open', dir: '/w' })
    expect(await s.handle({ op: 'put', path: '/home/worker/in.md', content: '# in' })).toMatchObject({ ok: true })
    expect(f.calls.find(c => c.cmd === 'sh')?.opts).toMatchObject({ input: '# in', cwd: '/' })
    expect((await s.handle({ op: 'put', path: 'relative.md', content: '' })).error).toMatch(/absolute/)
    const p = await s.handle({ id: 9, op: 'patch', exclude: ['.cache'] })
    expect(p).toEqual({ id: 9, ok: true, file: '/tmp/x/build.patch' })
    expect(f.calls.find(c => c.cmd === 'git' && c.args[0] === 'add')?.args).toEqual(['add', '-A', '--', '.', ':(exclude)node_modules', ':(exclude).cache'])
    expect(f.state.patchedFrom).toBe('abc1234def->/tmp/x/build.patch')
  })

  it('refuses work before open, reports errors as replies, and closes once', async () => {
    const f = fakeSandbox()
    const s = createSession({ open: async () => f.sb, tmpDir: () => '/tmp/x', log: () => {} })
    expect(await s.handle({ id: 1, op: 'exec', cmd: 'ls' })).toEqual({ id: 1, ok: false, error: 'no sandbox open: send "open" first' })
    expect((await s.handle({ op: 'open', dir: 'relative' })).error).toMatch(/absolute "dir"/)
    expect((await s.handle({ op: 'nope' })).error).toBe('unknown op "nope"')
    await s.handle({ op: 'open', dir: '/w' })
    expect(await s.handle({ id: 4, op: 'close' })).toEqual({ id: 4, ok: true })
    await s.close()
    expect(f.state.closed).toBe(1)
    const failing = createSession({ open: async () => { throw new Error('Docker is not running') }, tmpDir: () => '/tmp/x', log: () => {} })
    expect(await failing.handle({ id: 5, op: 'open', dir: '/w' })).toEqual({ id: 5, ok: false, error: 'Docker is not running' })
  })
})
