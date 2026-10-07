/**
 * Flow-test harness (roadmap Phase 81): a disposable Postgres and Redis, the real worker as a
 * child process, and helpers to seed and assert. The app and the factory run unmodified: they
 * talk to "Neon" over HTTP and neon-local.cjs answers from the local Postgres.
 *
 *   FLOW_DATABASE_URL  local Postgres server (default postgresql://postgres:postgres@127.0.0.1:5433/postgres)
 *   FLOW_REDIS_URL     local Redis, a database the suite may flush (default redis://127.0.0.1:6380/5)
 *
 * `docker compose --profile flow up -d` starts both on those ports. The suite drops and creates
 * its own databases and flushes its Redis database, so both URLs must point at this machine (or
 * a CI service container); anything else is refused.
 */
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import pg from 'pg'
import { Queue } from 'bullmq'
import { QUEUE_NAME, QUEUE_PREFIX, WORKER_STATUS_KEY, workerConnection } from '../../../factory/lib/queue'

export const ROOT = process.cwd()
if (!existsSync(path.join(ROOT, 'factory', 'worker.ts'))) throw new Error(`run the flow tests from the repo root (cwd is ${ROOT})`)

export const SHIM = path.join(ROOT, 'tests', 'flow', 'harness', 'neon-local.cjs')
export const FAKE_RUN = 'tests/flow/fixtures/fake-run.ts'

/** factory/factory.config.json's allowlist: the app imports that file directly, so seeds use its repos. */
const ALLOWLIST = (JSON.parse(readFileSync(path.join(ROOT, 'factory', 'factory.config.json'), 'utf8')) as { repos: string[] }).repos

export const FLOW = {
  pgServerUrl: process.env.FLOW_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5433/postgres',
  redisUrl: process.env.FLOW_REDIS_URL ?? 'redis://127.0.0.1:6380/5',
  ownerId: 'flow-owner',
  otherUserId: 'flow-other',
  allowlist: ALLOWLIST,
  allowlistedRepo: ALLOWLIST[0],
  outsideRepo: 'flow-owner/not-on-the-allowlist',
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', 'postgres', 'redis'])

/** The suite drops databases and flushes Redis: never anywhere but this machine or a CI service. */
export function assertLocal(url: string, what: string): void {
  const host = new URL(url).hostname
  if (!LOCAL_HOSTS.has(host) && process.env.FLOW_ALLOW_REMOTE !== '1') {
    throw new Error(`${what} must be local (got host ${host}); the flow suite drops databases and flushes Redis`)
  }
}
assertLocal(FLOW.pgServerUrl, 'FLOW_DATABASE_URL')
assertLocal(FLOW.redisUrl, 'FLOW_REDIS_URL')

/** What the app and the factory are given as their database: served by neon-local.cjs. */
export function neonUrl(database: string): string {
  return `postgresql://flow:flow@db.flow.neon.local/${database}`
}

function localUrl(database: string): string {
  const u = new URL(FLOW.pgServerUrl)
  u.pathname = `/${database}`
  return u.href
}

// Timestamps are stored as UTC wall time (timestamp without time zone): read them back as UTC.
// (pg's default parses them in the local zone, and the suite runs in America/Los_Angeles.)
pg.types.setTypeParser(pg.types.builtins.TIMESTAMP, (s: string) => new Date(`${s.replace(' ', 'T')}Z`))

const pools = new Map<string, pg.Pool>()
function pool(database: string): pg.Pool {
  let p = pools.get(database)
  if (!p) {
    p = new pg.Pool({ connectionString: localUrl(database), max: 3, idleTimeoutMillis: 2_000, allowExitOnIdle: true })
    p.on('error', () => {})
    pools.set(database, p)
  }
  return p
}

/** Query a flow database directly (setup and assertions; the code under test goes through the shim). */
export async function q<T = Record<string, unknown>>(database: string, text: string, params: unknown[] = []): Promise<T[]> {
  const r = await pool(database).query({ text, values: params })
  return r.rows as T[]
}

export async function closePools(): Promise<void> {
  await Promise.all([...pools.values()].map(p => p.end().catch(() => {})))
  pools.clear()
}

let ddl: string | null = null
/** The schema as drizzle-kit generates it from src/lib/db/schema.ts (what `db:push` would create). */
export function schemaDdl(): string {
  ddl ??= execFileSync('npx', ['drizzle-kit', 'export', '--dialect=postgresql', '--schema=./src/lib/db/schema.ts'], {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (!/CREATE TABLE "agent_requests"/.test(ddl)) throw new Error('drizzle-kit export did not produce the schema')
  return ddl
}

/** Drop and recreate a flow database, optionally with the full schema. */
export async function createDatabase(database: string, opts: { schema?: boolean } = {}): Promise<void> {
  if (!/^agent_hq_flow[a-z0-9_]*$/.test(database)) throw new Error(`flow databases are named agent_hq_flow*: ${database}`)
  await pools.get(database)?.end().catch(() => {})
  pools.delete(database)
  const admin = new pg.Client({ connectionString: FLOW.pgServerUrl })
  await admin.connect()
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`)
    await admin.query(`CREATE DATABASE "${database}"`)
  } finally {
    await admin.end()
  }
  if (opts.schema !== false) await pool(database).query(schemaDdl())
}

export interface Seeded {
  ownerSession: string
  otherSession: string
  /** The owner's repo on the factory allowlist. */
  repoId: number
  /** The owner's repo that is not on it. */
  outsideRepoId: number
  /** The other user's copy of the allowlisted repo. */
  otherRepoId: number
  /** The owner's repos on the allowlist, `repoId` first (one open request per repo: specs take one each). */
  allowlistedRepoIds: number[]
}

/** Two users (the factory owner and someone else), their sessions, and repos in and out of the allowlist. */
export async function seed(database: string, opts: { allowlisted?: number } = {}): Promise<Seeded> {
  const now = new Date()
  const expires = new Date(now.getTime() + 6 * 3_600_000)
  await q(database, `INSERT INTO users (id, name, email, github_login, last_synced_at) VALUES
    ($1, 'Flow Owner', 'owner@flow.test', 'flow-owner', $3), ($2, 'Flow Other', 'other@flow.test', 'flow-other', $3)`,
  [FLOW.ownerId, FLOW.otherUserId, now.toISOString()])
  const ownerSession = `flow-session-${FLOW.ownerId}`
  const otherSession = `flow-session-${FLOW.otherUserId}`
  await q(database, 'INSERT INTO sessions (session_token, user_id, expires) VALUES ($1, $2, $5), ($3, $4, $5)',
    [ownerSession, FLOW.ownerId, otherSession, FLOW.otherUserId, expires.toISOString()])
  const repo = (owner: string, fullName: string, githubId: number) => q<{ id: number }>(database,
    `INSERT INTO repositories (user_id, github_id, name, owner, full_name, created_at, updated_at, lifecycle_status, tags)
     VALUES ($1, $2, $3, $4, $5, $6, $6, 'production', '{}') RETURNING id`,
    [owner, githubId, fullName.split('/')[1], fullName.split('/')[0], fullName, now.toISOString()]).then(r => r[0].id)
  const repoId = await repo(FLOW.ownerId, FLOW.allowlistedRepo, 9_001)
  const outsideRepoId = await repo(FLOW.ownerId, FLOW.outsideRepo, 9_002)
  const otherRepoId = await repo(FLOW.otherUserId, FLOW.allowlistedRepo, 9_003)
  const allowlistedRepoIds = [repoId]
  for (let i = 1; i < Math.min(opts.allowlisted ?? 1, FLOW.allowlist.length); i++) {
    allowlistedRepoIds.push(await repo(FLOW.ownerId, FLOW.allowlist[i], 9_100 + i))
  }
  return { ownerSession, otherSession, repoId, outsideRepoId, otherRepoId, allowlistedRepoIds }
}

/** A BullMQ handle on the factory queue, for assertions and test-only manipulation. */
export function flowQueue(): Queue {
  return new Queue(QUEUE_NAME, { connection: workerConnection(FLOW.redisUrl), prefix: QUEUE_PREFIX })
}

/** Empty the suite's Redis database (the queue, its schedulers, the worker's status key). */
export async function resetRedis(): Promise<void> {
  const queue = flowQueue()
  try {
    // BullMQ types its client narrowly; it is an ioredis connection.
    const client = await queue.client as unknown as { flushdb(): Promise<unknown> }
    await client.flushdb()
  } finally {
    await queue.close()
  }
}

export async function workerStatusRaw(): Promise<string | null> {
  const queue = flowQueue()
  try {
    return await (await queue.client).get(WORKER_STATUS_KEY)
  } finally {
    await queue.close()
  }
}

/** A factory home (lock, PAUSE, logs) and a config with schedules that never fire during a run. */
export function factoryHome(overrides: Record<string, unknown> = {}): { home: string; config: string } {
  const home = mkdtempSync(path.join(tmpdir(), 'agent-hq-flow-'))
  const base = JSON.parse(readFileSync(path.join(ROOT, 'factory', 'factory.config.json'), 'utf8')) as Record<string, unknown>
  const config = path.join(home, 'factory.config.json')
  writeFileSync(config, JSON.stringify({
    ...base,
    schedules: { cycle: '0 3 29 2 *', report: '45 6 29 2 *', scout: '10 17 29 2 *' },
    ...overrides,
  }, null, 2))
  return { home, config }
}

/** NODE_OPTIONS that load neon-local.cjs in every Node process started with it (and their children). */
export function shimNodeOptions(): string {
  const existing = (process.env.NODE_OPTIONS ?? '').split(/\s+/).filter(o => o && !o.includes('neon-local.cjs'))
  return [...existing, `--require=${SHIM.includes(' ') ? JSON.stringify(SHIM) : SHIM}`].join(' ')
}

/** The environment the worker (and its jobs) run with: local stack only, never .env.local's database. */
export function flowEnv(database: string, home: { home: string; config: string }, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    NODE_OPTIONS: shimNodeOptions(),
    NEON_LOCAL_PG_URL: FLOW.pgServerUrl,
    DATABASE_URL: neonUrl(database),
    FACTORY_DATABASE_URL: neonUrl(database),
    FACTORY_USER_ID: FLOW.ownerId,
    REDIS_URL: FLOW.redisUrl,
    FACTORY_HOME: home.home,
    FACTORY_CONFIG: home.config,
    // No Docker gate (the sandbox is the real run.ts's business) and no battery gate.
    FACTORY_SANDBOX: 'off',
    FACTORY_REQUIRE_AC: '0',
    // Nothing listens here: for the real run.ts, LiteLLM is down.
    FACTORY_LITELLM_URL: 'http://127.0.0.1:9',
    FACTORY_WORKER_CHILD: FAKE_RUN,
    ...extra,
  }
}

export interface WorkerHandle {
  child: ChildProcess
  logs: string[]
  waitForLog(re: RegExp, timeoutMs?: number): Promise<string>
  /** SIGTERM and wait for the exit code. */
  stop(timeoutMs?: number): Promise<number | null>
}

/** Start factory/worker.ts (one process: node --import tsx, so signals reach it directly). */
export async function startWorker(env: NodeJS.ProcessEnv): Promise<WorkerHandle> {
  if (!env.FACTORY_DATABASE_URL?.includes('.neon.local')) throw new Error('the flow worker must use a flow database')
  const child = spawn(process.execPath, ['--import', 'tsx', 'factory/worker.ts'], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })
  const logs: string[] = []
  const waiters: { re: RegExp; resolve: (line: string) => void }[] = []
  const onData = (buf: Buffer) => {
    for (const line of buf.toString().split('\n').filter(Boolean)) {
      logs.push(line)
      if (process.env.FLOW_DEBUG) console.log(`  [worker] ${line}`)
      for (const w of [...waiters]) if (w.re.test(line)) { waiters.splice(waiters.indexOf(w), 1); w.resolve(line) }
    }
  }
  child.stdout!.on('data', onData)
  child.stderr!.on('data', onData)
  const exited = new Promise<number | null>(resolve => child.on('exit', code => resolve(code)))

  const waitForLog = (re: RegExp, timeoutMs = 30_000) => {
    const seen = logs.find(l => re.test(l))
    if (seen) return Promise.resolve(seen)
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`worker never logged ${re} within ${timeoutMs} ms; last lines:\n${logs.slice(-15).join('\n')}`)), timeoutMs)
      waiters.push({ re, resolve: line => { clearTimeout(timer); resolve(line) } })
      void exited.then(code => { clearTimeout(timer); reject(new Error(`worker exited (${code}) before logging ${re}:\n${logs.slice(-15).join('\n')}`)) })
    })
  }
  const stop = async (timeoutMs = 20_000) => {
    if (child.exitCode !== null) return child.exitCode
    child.kill('SIGTERM')
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    const code = await exited
    clearTimeout(timer)
    return code
  }
  await waitForLog(/ready — queue/, 60_000)
  return { child, logs, waitForLog, stop }
}

/** Poll until `fn` returns something truthy (or throw with `what` after the timeout). */
export async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, what: string, timeoutMs = 30_000, intervalMs = 150): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let last: unknown
  for (;;) {
    try {
      const v = await fn()
      if (v) return v
    } catch (err) {
      last = err
    }
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}${last ? ` (last error: ${last instanceof Error ? last.message : String(last)})` : ''}`)
    await new Promise(r => setTimeout(r, intervalMs))
  }
}

export interface RequestRowView {
  id: string
  status: string
  reason: string | null
  attempts: number
  pr_url: string | null
  findings: string | null
  run_id: string | null
  claimed_at: Date | null
  resolved_at: Date | null
}

export async function requestRow(database: string, id: string): Promise<RequestRowView | null> {
  const [row] = await q<RequestRowView>(database, 'SELECT id, status, reason, attempts, pr_url, findings, run_id, claimed_at, resolved_at FROM agent_requests WHERE id = $1', [id])
  return row ?? null
}

/** Wait for a request to reach one of `statuses` and return its row. */
export function waitForRequest(database: string, id: string, statuses: string[], timeoutMs = 30_000): Promise<RequestRowView> {
  return waitFor(async () => {
    const row = await requestRow(database, id)
    return row && statuses.includes(row.status) ? row : null
  }, `request ${id} → ${statuses.join('|')}`, timeoutMs)
}
