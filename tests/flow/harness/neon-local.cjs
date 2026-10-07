/**
 * Neon's SQL-over-HTTP, served by a local Postgres (flow tests only).
 *
 * The app and the factory reach Neon through @neondatabase/serverless's HTTP driver, which POSTs
 * each query to https://<host>/sql. This file replaces global fetch for one family of hosts,
 * `*.neon.local`, and answers those requests from a local Postgres, so the real code runs
 * unmodified against a disposable database. Every other request goes to the real fetch.
 *
 *   NEON_LOCAL_PG_URL=postgresql://postgres:postgres@127.0.0.1:5433/postgres   (the local server)
 *   DATABASE_URL=postgresql://flow:flow@db.flow.neon.local/agent_hq_flow       (what the code sees)
 *
 * The database name in the connection string picks the local database, so one server can hold
 * several (the migration test builds two). Load it with NODE_OPTIONS=--require=<this file>: it
 * then reaches every child process too (the worker, its jobs, next dev). The protocol mirrors
 * @neondatabase/serverless 1.x: array rows of raw text (the driver parses types itself), batches
 * as one transaction, errors as HTTP 400 with Postgres's error fields.
 */
'use strict'

const LOCAL = process.env.NEON_LOCAL_PG_URL

if (LOCAL && !globalThis.__neonLocalFetch) {
  const { Pool } = require('pg')
  const realFetch = globalThis.fetch
  const pools = new Map()
  // Raw text for every type: the Neon driver applies its own parsers to what we return.
  const RAW_TEXT = { getTypeParser: () => value => value }
  const ERROR_FIELDS = ['severity', 'code', 'detail', 'hint', 'position', 'internalPosition', 'internalQuery',
    'where', 'schema', 'table', 'column', 'dataType', 'constraint', 'file', 'line', 'routine']

  const poolFor = database => {
    let pool = pools.get(database)
    if (!pool) {
      const url = new URL(LOCAL)
      url.pathname = `/${database}`
      // allowExitOnIdle: short-lived processes (a job's child) must be able to exit.
      pool = new Pool({ connectionString: url.href, max: 4, idleTimeoutMillis: 2_000, allowExitOnIdle: true })
      pool.on('error', () => {})
      pools.set(database, pool)
    }
    return pool
  }

  const toResult = r => ({
    command: r.command,
    rowCount: r.rowCount,
    rowAsArray: true,
    fields: (r.fields ?? []).map(f => ({
      name: f.name, tableID: f.tableID, columnID: f.columnID, dataTypeID: f.dataTypeID,
      dataTypeSize: f.dataTypeSize, dataTypeModifier: f.dataTypeModifier, format: f.format,
    })),
    rows: r.rows ?? [],
  })

  const runQuery = async (client, q) => {
    const r = await client.query({ text: q.query, values: q.params ?? [], rowMode: 'array', types: RAW_TEXT })
    // A multi-statement script (no parameters) returns one result per statement; Neon returns the last.
    return toResult(Array.isArray(r) ? r[r.length - 1] : r)
  }

  // "RepeatableRead" → "REPEATABLE READ"
  const isolation = level => level.replace(/([a-z])([A-Z])/g, '$1 $2').toUpperCase()

  const runBatch = async (pool, queries, headers) => {
    const client = await pool.connect()
    try {
      let begin = 'BEGIN'
      const level = headers.get('neon-batch-isolation-level')
      if (level) begin += ` ISOLATION LEVEL ${isolation(level)}`
      if (headers.get('neon-batch-read-only') === 'true') begin += ' READ ONLY'
      if (headers.get('neon-batch-deferrable') === 'true') begin += ' DEFERRABLE'
      await client.query(begin)
      const results = []
      for (const q of queries) results.push(await runQuery(client, q))
      await client.query('COMMIT')
      return { results }
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }
  }

  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  const neonLocalFetch = async (input, init) => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    let url
    try { url = new URL(href) } catch { return realFetch(input, init) }
    if (!url.hostname.endsWith('.neon.local') || !url.pathname.endsWith('/sql')) return realFetch(input, init)

    const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
    const conn = headers.get('neon-connection-string') ?? ''
    const database = decodeURIComponent(new URL(conn.replace(/^postgres(ql)?:/, 'http:')).pathname.slice(1))
    const raw = init?.body ?? (input instanceof Request ? await input.text() : '')
    try {
      const body = JSON.parse(typeof raw === 'string' ? raw : await new Response(raw).text())
      const pool = poolFor(database)
      const payload = Array.isArray(body.queries) ? await runBatch(pool, body.queries, headers) : await runQuery(pool, body)
      return json(200, payload)
    } catch (err) {
      const out = { message: err instanceof Error ? err.message : String(err) }
      for (const k of ERROR_FIELDS) if (err && err[k] !== undefined) out[k] = err[k]
      return json(400, out)
    }
  }

  globalThis.__neonLocalFetch = neonLocalFetch
  globalThis.fetch = neonLocalFetch
}
