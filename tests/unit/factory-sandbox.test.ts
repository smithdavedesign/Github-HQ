import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_SANDBOX, loadConfig } from '../../factory/lib/config'
import {
  RELAY_URL, WORKDIR, egressRunArgs, execArgs, imageTag, proxyEnv, sandboxImages, sandboxModels, sandboxNames, upstreamUrl, workerRunArgs,
} from '../../factory/lib/sandbox'
import { aiderEnv, claudeCodeEnv, runHarness } from '../../factory/lib/harness'
import { runAudit, runChecks } from '../../factory/lib/checks'
import { run, type ProcOptions, type Runner } from '../../factory/lib/proc'

const names = sandboxNames('/home/test', 'abcd1234')
const env = (e: Record<string, string> = {}) => e as NodeJS.ProcessEnv

describe('sandbox images', () => {
  it('tags images by a hash of their build inputs', () => {
    expect(imageTag('w', ['FROM node'])).toMatch(/^w:[0-9a-f]{12}$/)
    expect(imageTag('w', ['FROM node'])).toBe(imageTag('w', ['FROM node']))
    expect(imageTag('w', ['FROM node'])).not.toBe(imageTag('w', ['FROM node:22']))
  })
  it('derives both tags from the Dockerfiles in factory/docker', () => {
    const imgs = sandboxImages(DEFAULT_SANDBOX)
    expect(imgs.worker.tag).toMatch(/^repohq-factory-worker:[0-9a-f]{12}$/)
    expect(imgs.egress.tag).toMatch(/^repohq-factory-egress:[0-9a-f]{12}$/)
  })
})

describe('worker container', () => {
  const args = workerRunArgs(names, 'img:1', DEFAULT_SANDBOX)
  const joined = args.join(' ')

  it('has no mounts, no Docker socket, no privileges', () => {
    for (const flag of ['-v', '--volume', '--mount', '--privileged', '--device', '--pid', '--ipc']) expect(args).not.toContain(flag)
    expect(joined).not.toMatch(/docker\.sock|\/Users\/|\.ssh|\.config\/gh|\.aws/)
    expect(joined).toContain('--cap-drop ALL')
    expect(joined).toContain('--security-opt no-new-privileges')
    expect(joined).toContain('--user worker')
    expect(args).not.toContain('--cap-add')
  })
  it('sits only on the internal sandbox network', () => {
    expect(args[args.indexOf('--network') + 1]).toBe(names.network)
    expect(args.filter(a => a === '--network')).toHaveLength(1)
  })
  it('is resource-limited and exits by itself after its lifetime', () => {
    expect(joined).toContain(`--cpus ${DEFAULT_SANDBOX.cpus}`)
    expect(joined).toContain(`--memory ${DEFAULT_SANDBOX.memory} --memory-swap ${DEFAULT_SANDBOX.memory}`)
    expect(joined).toContain(`--pids-limit ${DEFAULT_SANDBOX.pidsLimit}`)
    expect(args.slice(-2)).toEqual(['sleep', String(DEFAULT_SANDBOX.lifetimeMs / 1000)])
    expect(args).toContain('--init')
  })
  it('gets proxy settings and nothing secret', () => {
    const env = args.filter((_, i) => args[i - 1] === '-e')
    expect(env.every(e => /^(HTTPS?_PROXY|https?_proxy|NO_PROXY|no_proxy|npm_config_(https_)?proxy|YARN_HTTPS?_PROXY)=/.test(e))).toBe(true)
    expect(joined).not.toMatch(/GH_TOKEN|GITHUB_TOKEN|ANTHROPIC|DATABASE_URL|sk-/)
  })
  it('is labelled for the crash sweeper', () => {
    expect(args[args.indexOf('--label') + 1]).toBe(names.label)
    expect(sandboxNames('/home/test').label).toBe(names.label)
    expect(sandboxNames('/home/other').label).not.toBe(names.label)
  })
})

describe('egress container', () => {
  it('carries the host and model allowlists and the LiteLLM upstream', () => {
    const args = egressRunArgs(names, 'egress:1', { allowHosts: ['registry.npmjs.org', 'registry.yarnpkg.com'], allowModels: ['local-agent', 'free-agent'], upstream: 'http://host.docker.internal:4000' })
    expect(args).toContain('EGRESS_ALLOW_HOSTS=registry.npmjs.org registry.yarnpkg.com')
    expect(args).toContain('EGRESS_ALLOW_MODELS=local-agent free-agent')
    expect(args).toContain('LITELLM_UPSTREAM=http://host.docker.internal:4000')
    expect(args.join(' ')).toContain('--cap-drop ALL')
    // The key is passed by name only (docker reads it from its own env), never on the command line.
    expect(args).toContain('LITELLM_KEY')
    expect(args.join(' ')).not.toMatch(/LITELLM_KEY=/)
  })
  it('maps a localhost LiteLLM URL to the Docker host', () => {
    expect(upstreamUrl('http://localhost:4000')).toBe('http://host.docker.internal:4000')
    expect(upstreamUrl('http://127.0.0.1:4000/')).toBe('http://host.docker.internal:4000')
    expect(upstreamUrl('http://gateway.lan:4000')).toBe('http://gateway.lan:4000')
  })
  it('routes package managers through the proxy but model calls straight to the relay', () => {
    const env = proxyEnv()
    expect(env.HTTPS_PROXY).toBe('http://egress:8888')
    expect(env.NO_PROXY.split(',')).toContain('egress')
    expect(new URL(RELAY_URL).hostname).toBe('egress')
  })
})

describe('sandboxModels', () => {
  const models = { M0: 'local-agent', M1: 'free-agent', M2: 'cloud-smart' }
  it('allows only free tiers at a $0 budget', () => {
    expect(sandboxModels(models, { paidBudgetUsd: 0, extra: ['local-small'] })).toEqual(['local-agent', 'free-agent', 'local-small'])
  })
  it('adds the paid alias only when a paid budget exists', () => {
    expect(sandboxModels(models, { paidBudgetUsd: 5 })).toContain('cloud-smart')
  })
})

describe('execArgs', () => {
  it('forwards only the given overrides, never the host environment', () => {
    process.env.FACTORY_TEST_HOST_SECRET = 'do-not-forward'
    const args = execArgs('ctr', 'npm', ['test'], { env: { CI: '1' } })
    expect(args.join(' ')).not.toContain('do-not-forward')
    expect(args.filter(a => a === '-e')).toHaveLength(1)
    expect(args).toContain('CI=1')
    delete process.env.FACTORY_TEST_HOST_SECRET
  })
  it('runs in the workspace under an in-container timeout', () => {
    expect(execArgs('ctr', 'npm', ['test'], { timeoutMs: 90_500 })).toEqual(['exec', '-w', WORKDIR, 'ctr', 'timeout', '-k', '10', '91', 'npm', 'test'])
  })
  it('opens stdin only when there is input, and honours cwd', () => {
    expect(execArgs('ctr', 'cat', [], { input: 'x', cwd: '/tmp' }).slice(0, 4)).toEqual(['exec', '-i', '-w', '/tmp'])
    expect(execArgs('ctr', 'cat', [])).not.toContain('-i')
  })
})

describe('run (host)', () => {
  it('merges env overrides onto the inherited environment', async () => {
    const r = await run('sh', ['-c', 'printf "%s|%s" "$FACTORY_TEST_A" "${PATH:+has-path}"'], { env: { FACTORY_TEST_A: 'x' } })
    expect(r.output).toBe('x|has-path')
  })
})

/** A Runner that records calls and answers with `ok`. */
function fakeRunner(output = ''): { runner: Runner; calls: { cmd: string; args: string[]; opts?: ProcOptions }[] } {
  const calls: { cmd: string; args: string[]; opts?: ProcOptions }[] = []
  return {
    calls,
    runner: async (cmd, args, opts) => {
      calls.push({ cmd, args, opts })
      return { code: 0, output, durationMs: 1, timedOut: false }
    },
  }
}

describe('runner injection', () => {
  it('runChecks runs each check through the given runner with CI overrides only', async () => {
    const f = fakeRunner()
    const res = await runChecks([{ name: 'test', cmd: 'npm', args: ['run', 'test'], display: 'npm run test' }], WORKDIR, 1000, f.runner)
    expect(res[0].ok).toBe(true)
    expect(f.calls[0]).toMatchObject({ cmd: 'npm', args: ['run', 'test'], opts: { cwd: WORKDIR, env: { CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' } } })
  })
  it('runAudit uses the runner', async () => {
    const f = fakeRunner('{"metadata":{"vulnerabilities":{"critical":1,"high":2,"moderate":0,"low":0}}}')
    expect(await runAudit(WORKDIR, 1000, f.runner)).toEqual({ critical: 1, high: 2, moderate: 0, low: 0 })
    expect(f.calls[0].cmd).toBe('npm')
  })
  it('runHarness sends Aider to the relay through the runner, with only its own env', async () => {
    const cfg = loadConfig(env())
    const sandboxCfg = { ...cfg, litellm: { ...cfg.litellm, url: RELAY_URL } }
    const f = fakeRunner()
    await runHarness({ tier: 'M0', model: 'local-agent', cwd: WORKDIR, prompt: 'fix', files: ['a.ts'] }, sandboxCfg, f.runner)
    expect(f.calls[0].cmd).toBe('aider')
    expect(f.calls[0].opts?.env).toEqual({ OPENAI_API_BASE: `${RELAY_URL}/v1`, OPENAI_API_KEY: cfg.litellm.key })
  })
  it('runHarness sends Claude Code to the relay through the runner', async () => {
    const cfg = loadConfig(env())
    const f = fakeRunner('{"type":"result","is_error":false,"result":"done","usage":{"input_tokens":5,"output_tokens":2}}')
    const h = await runHarness({ tier: 'M1', model: 'free-agent', cwd: WORKDIR, prompt: 'fix' }, { ...cfg, litellm: { ...cfg.litellm, url: RELAY_URL } }, f.runner)
    expect(h.ok).toBe(true)
    expect(f.calls[0].cmd).toBe('claude')
    expect(f.calls[0].opts?.env?.ANTHROPIC_BASE_URL).toBe(RELAY_URL)
  })
  it('harness env helpers contain no inherited host variables', () => {
    const cfg = loadConfig(env())
    expect(Object.keys(aiderEnv(cfg)).sort()).toEqual(['OPENAI_API_BASE', 'OPENAI_API_KEY'])
    expect(Object.keys(claudeCodeEnv({ model: 'free-agent' }, cfg)).every(k => k.startsWith('ANTHROPIC_') || k === 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC')).toBe(true)
  })
})

describe('sandbox config', () => {
  it('defaults to the Docker sandbox', () => {
    expect(loadConfig(env()).sandbox.mode).toBe('docker')
    expect(loadConfig(env()).sandbox.allowHosts).toContain('registry.npmjs.org')
  })
  it('FACTORY_SANDBOX=off switches to host execution', () => {
    expect(loadConfig(env({ FACTORY_SANDBOX: 'off' })).sandbox.mode).toBe('off')
  })
})

describe('Sandbox lifecycle (docker mocked)', () => {
  const dockerCalls: string[][] = []
  let nextExec: { code: number; durationMs: number } = { code: 0, durationMs: 1 }
  // One mock for the whole block, steered by these flags: re-registering a mock for the same
  // module with a second vi.doMock was flaky (vitest's mock registry survives resetModules).
  let failWorkerStart = false

  beforeEach(() => {
    dockerCalls.length = 0
    nextExec = { code: 0, durationMs: 1 }
    failWorkerStart = false
    vi.resetModules()
    vi.doMock('../../factory/lib/proc', () => ({
      run: async (cmd: string, args: string[]) => {
        dockerCalls.push([cmd, ...args])
        if (failWorkerStart && args[0] === 'run' && args.some(a => a.endsWith('-worker'))) return { code: 125, output: 'no such image', durationMs: 1, timedOut: false }
        if (args[0] === 'exec' && args.includes('timeout')) return { code: nextExec.code, output: '', durationMs: nextExec.durationMs, timedOut: false }
        return { code: 0, output: 'ok\n', durationMs: 1, timedOut: false }
      },
    }))
  })

  async function openSandbox() {
    const { Sandbox } = await import('../../factory/lib/sandbox')
    return Sandbox.open({ cfg: DEFAULT_SANDBOX, litellmUrl: 'http://localhost:4000', litellmKey: 'sk-real', allowModels: ['local-agent'], scope: '/home/test', images: { worker: 'w:1', egress: 'e:1' } })
  }

  it('creates an internal network, the egress gateway, then the worker', async () => {
    const sb = await openSandbox()
    const subcommands = dockerCalls.map(c => c.slice(1, 3).join(' '))
    expect(subcommands[0]).toBe('network create')
    expect(dockerCalls[0]).toContain('--internal')
    expect(dockerCalls.some(c => c.includes(sb.names.egress) && c[1] === 'run')).toBe(true)
    expect(dockerCalls.some(c => c[1] === 'network' && c[2] === 'connect' && c.includes('egress'))).toBe(true)
    expect(dockerCalls.findIndex(c => c.includes(sb.names.worker) && c[1] === 'run')).toBeGreaterThan(dockerCalls.findIndex(c => c.includes(sb.names.egress) && c[1] === 'run'))
  })

  it('reports an in-container timeout as timedOut', async () => {
    const sb = await openSandbox()
    nextExec = { code: 124, durationMs: 2_100 }
    expect((await sb.run('sleep', ['30'], { timeoutMs: 2_000 })).timedOut).toBe(true)
    nextExec = { code: 1, durationMs: 50 }
    expect((await sb.run('false', [], { timeoutMs: 2_000 })).timedOut).toBe(false)
  })

  it('close removes containers and network exactly once', async () => {
    const sb = await openSandbox()
    await sb.close()
    await sb.close()
    expect(dockerCalls.filter(c => c[1] === 'rm' && c.includes(sb.names.worker))).toHaveLength(1)
    expect(dockerCalls.filter(c => c[1] === 'network' && c[2] === 'rm')).toHaveLength(1)
  })

  it('tears everything down if a step fails while opening', async () => {
    failWorkerStart = true
    await expect(openSandbox()).rejects.toThrow(/sandbox worker failed/)
    expect(dockerCalls.some(c => c[1] === 'rm')).toBe(true)
    expect(dockerCalls.some(c => c[1] === 'network' && c[2] === 'rm')).toBe(true)
  })
})
