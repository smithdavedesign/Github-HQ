import { createSign } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'

/**
 * The factory's own GitHub identity (roadmap Phase 66): the `repohq-factory` GitHub App. When it's
 * configured, every host-side `gh` and `git` call runs with a short-lived installation token, so
 * factory branches, PRs, labels and comments are `repohq-factory[bot]`'s, not the owner's. That's
 * what lets the owner approve factory PRs, and so turn on required reviews on `main` (Phase 65):
 * GitHub never lets a PR's author approve it.
 *
 * Config: `FACTORY_GH_APP_CLIENT_ID` (in ~/.repohq-factory/env) plus the private key at
 * `FACTORY_GH_APP_KEY` (default ~/.repohq-factory/github-app.pem, mode 600). Without both, nothing
 * changes: gh and git use GH_TOKEN or the owner's gh login as before.
 *
 * Calls that must stay on the owner's login (Copilot, `gh api user`, searches across every repo)
 * pass `env: { GH_TOKEN: '' }` and are left alone by proc.ts.
 */

export interface AppAuth {
  clientId: string
  keyPath: string
}

export function appAuthFromEnv(env: Record<string, string | undefined> = process.env): AppAuth | null {
  const clientId = env.FACTORY_GH_APP_CLIENT_ID?.trim()
  if (!clientId) return null
  const home = env.FACTORY_HOME ?? path.join(homedir(), '.repohq-factory')
  const keyPath = env.FACTORY_GH_APP_KEY ?? path.join(home, 'github-app.pem')
  return existsSync(keyPath) ? { clientId, keyPath } : null
}

/** RS256 JWT the app signs to ask for an installation token (valid ≤ 10 minutes; backdated for clock skew). */
export function appJwt(auth: AppAuth, nowSec = Math.floor(Date.now() / 1000)): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iat: nowSec - 60, exp: nowSec + 540, iss: auth.clientId })}`
  const sig = createSign('RSA-SHA256').update(unsigned).sign(readFileSync(auth.keyPath, 'utf8')).toString('base64url')
  return `${unsigned}.${sig}`
}

type Fetch = typeof fetch

async function api<T>(fetchFn: Fetch, url: string, auth: string, method = 'GET'): Promise<T> {
  const r = await fetchFn(`https://api.github.com${url}`, {
    method,
    headers: { Authorization: auth, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(30_000),
  })
  if (!r.ok) throw new Error(`GitHub ${method} ${url}: HTTP ${r.status}`)
  return (await r.json()) as T
}

/** A token is reused until this close to expiry (installation tokens last 1 hour). */
const REFRESH_MS = 10 * 60_000

export interface Identity {
  /** `repohq-factory[bot]` */
  name: string
  /** `<id>+repohq-factory[bot]@users.noreply.github.com`, so GitHub links commits to the bot. */
  email: string
}

export class GitHubApp {
  private token: { value: string; expiresAt: number } | null = null
  private inflight: Promise<string> | null = null
  private installationId: number | null = null
  private identity: Identity | null = null

  constructor(private readonly auth: AppAuth, private readonly fetchFn: Fetch = fetch) {}

  /** A valid installation token, minted again when the cached one is within 10 minutes of expiry. */
  async installationToken(now = Date.now()): Promise<string> {
    if (this.token && this.token.expiresAt - now > REFRESH_MS) return this.token.value
    this.inflight ??= this.mint().finally(() => { this.inflight = null })
    return this.inflight
  }

  private async mint(): Promise<string> {
    const jwt = `Bearer ${appJwt(this.auth)}`
    if (this.installationId === null) {
      // One installation: the owner's account (the app is "Only on this account").
      const installs = await api<{ id: number }[]>(this.fetchFn, '/app/installations', jwt)
      if (installs.length === 0) throw new Error('the GitHub App is not installed on any account')
      this.installationId = installs[0].id
    }
    const t = await api<{ token: string; expires_at: string }>(this.fetchFn, `/app/installations/${this.installationId}/access_tokens`, jwt, 'POST')
    this.token = { value: t.token, expiresAt: Date.parse(t.expires_at) }
    return t.token
  }

  /** Commit identity for the bot user behind the app. */
  async botIdentity(): Promise<Identity> {
    if (this.identity) return this.identity
    const app = await api<{ slug: string }>(this.fetchFn, '/app', `Bearer ${appJwt(this.auth)}`)
    const name = `${app.slug}[bot]`
    const user = await api<{ id: number }>(this.fetchFn, `/users/${encodeURIComponent(name)}`, `token ${await this.installationToken()}`)
    this.identity = { name, email: `${user.id}+${name}@users.noreply.github.com` }
    return this.identity
  }
}

let shared: GitHubApp | null | undefined

/** The process-wide app client, or null when the app isn't configured. */
export function githubApp(): GitHubApp | null {
  if (shared === undefined) {
    const auth = appAuthFromEnv()
    shared = auth ? new GitHubApp(auth) : null
  }
  return shared
}

let warned = false

/**
 * Environment for a host-side `gh` / `git` call: the app's token (and, for git, the bot as commit
 * author and committer). Empty when the app isn't configured, when the caller set GH_TOKEN itself
 * (Copilot and other owner-login calls pass `GH_TOKEN: ''`), or when minting fails. A failure is
 * logged once and the call falls back to the inherited credentials, so the night shift keeps
 * running; the morning report shows who authored each PR.
 */
export async function appEnvFor(cmd: string, callerEnv: Record<string, string | undefined> | undefined): Promise<Record<string, string>> {
  if (cmd !== 'gh' && cmd !== 'git') return {}
  if (callerEnv && 'GH_TOKEN' in callerEnv) return {}
  const app = githubApp()
  if (!app) return {}
  try {
    const token = await app.installationToken()
    if (cmd === 'gh') return { GH_TOKEN: token }
    const id = await app.botIdentity()
    return {
      GH_TOKEN: token,
      GIT_AUTHOR_NAME: id.name, GIT_AUTHOR_EMAIL: id.email, GIT_COMMITTER_NAME: id.name, GIT_COMMITTER_EMAIL: id.email,
    }
  } catch (err) {
    if (!warned) {
      warned = true
      console.warn(`[factory] GitHub App token unavailable, using the inherited gh credentials: ${err instanceof Error ? err.message : err}`)
    }
    return {}
  }
}
