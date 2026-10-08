import { afterEach, describe, expect, it, vi } from 'vitest'
import { createVerify, generateKeyPairSync } from 'node:crypto'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { GitHubApp, appAuthFromEnv, appJwt } from '../../factory/lib/github-app'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const dir = mkdtempSync(path.join(tmpdir(), 'gh-app-'))
const keyPath = path.join(dir, 'github-app.pem')
writeFileSync(keyPath, privateKey.export({ type: 'pkcs8', format: 'pem' }))
const auth = { clientId: 'Iv23test', keyPath }

describe('GitHub App config', () => {
  it('needs both the client id and the key file', () => {
    expect(appAuthFromEnv({ FACTORY_GH_APP_CLIENT_ID: 'Iv23test', FACTORY_GH_APP_KEY: keyPath })).toEqual(auth)
    expect(appAuthFromEnv({ FACTORY_GH_APP_KEY: keyPath })).toBeNull()
    expect(appAuthFromEnv({ FACTORY_GH_APP_CLIENT_ID: 'Iv23test', FACTORY_GH_APP_KEY: path.join(dir, 'missing.pem') })).toBeNull()
  })
  it('signs an RS256 JWT issued by the client id, backdated and valid under 10 minutes', () => {
    const jwt = appJwt(auth, 1_000_000)
    const [h, b, s] = jwt.split('.')
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' })
    expect(JSON.parse(Buffer.from(b, 'base64url').toString())).toEqual({ iat: 999_940, exp: 1_000_540, iss: 'Iv23test' })
    expect(createVerify('RSA-SHA256').update(`${h}.${b}`).verify(publicKey, Buffer.from(s, 'base64url'))).toBe(true)
  })
})

describe('installation tokens', () => {
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })
  const fakeGitHub = (expiresAt: () => string) => {
    let minted = 0
    const fetchFn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url)
      if (u.endsWith('/app/installations')) return json([{ id: 42 }])
      if (u.endsWith('/app/installations/42/access_tokens') && init?.method === 'POST') return json({ token: `t${++minted}`, expires_at: expiresAt() })
      if (u.endsWith('/app')) return json({ slug: 'repohq-factory' })
      if (u.includes('/users/repohq-factory%5Bbot%5D')) return json({ id: 777 })
      return new Response('', { status: 404 })
    })
    return fetchFn as unknown as typeof fetch
  }

  it('reuses a token until it is within 10 minutes of expiry, then mints a new one', async () => {
    const t0 = Date.parse('2026-10-07T18:00:00Z')
    const app = new GitHubApp(auth, fakeGitHub(() => new Date(t0 + 60 * 60_000).toISOString()))
    expect(await app.installationToken(t0)).toBe('t1')
    expect(await app.installationToken(t0 + 45 * 60_000)).toBe('t1')
    expect(await app.installationToken(t0 + 51 * 60_000)).toBe('t2')
  })
  it('concurrent callers share one mint', async () => {
    const f = fakeGitHub(() => new Date(Date.now() + 3_600_000).toISOString())
    const app = new GitHubApp(auth, f)
    expect(await Promise.all([app.installationToken(), app.installationToken()])).toEqual(['t1', 't1'])
    expect((f as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(c => String(c[0]).endsWith('access_tokens'))).toHaveLength(1)
  })
  it('commits as the bot user GitHub links to the app', async () => {
    const app = new GitHubApp(auth, fakeGitHub(() => new Date(Date.now() + 3_600_000).toISOString()))
    expect(await app.botIdentity()).toEqual({ name: 'repohq-factory[bot]', email: '777+repohq-factory[bot]@users.noreply.github.com' })
  })
  it('throws on an HTTP error (appEnvFor then falls back to the inherited credentials)', async () => {
    const app = new GitHubApp(auth, (async () => new Response('', { status: 401 })) as unknown as typeof fetch)
    await expect(app.installationToken()).rejects.toThrow(/HTTP 401/)
  })
})

describe('which calls get the app token', () => {
  afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })
  it('only gh and git, never when the caller set GH_TOKEN, and nothing when unconfigured', async () => {
    vi.stubEnv('FACTORY_GH_APP_CLIENT_ID', '')
    const { appEnvFor } = await import('../../factory/lib/github-app')
    expect(await appEnvFor('gh', undefined)).toEqual({})
    expect(await appEnvFor('docker', undefined)).toEqual({})
    expect(await appEnvFor('gh', { GH_TOKEN: '' })).toEqual({})
  })
})
