import { neon, type NeonQueryFunction } from '@neondatabase/serverless'
import postgres from 'postgres'

/**
 * The factory's database client. A localhost URL is a local Postgres, reached with postgres-js; anything else is
 * Neon over HTTP. Both are used the same way: as a tagged template (sql`…`) and as sql.query(text, params).
 * Neon's 402 quota errors (2026-10-25) are why a local Postgres had to be possible.
 */
export type SqlClient = NeonQueryFunction<false, false>

export const isLocalDatabase = (url: string): boolean => /\/\/([^@/]*@)?(localhost|127\.0\.0\.1)([:/]|$)/.test(url)

/** A postgres-js client shaped like Neon's: its tagged template as is, plus .query(text, params). */
export function asNeonClient(pg: postgres.Sql): SqlClient {
  const client = pg as unknown as SqlClient & { query?: unknown }
  if (!client.query) (client as { query: unknown }).query = (text: string, params: unknown[] = []) => pg.unsafe(text, params as postgres.ParameterOrJSON<never>[])
  return client as SqlClient
}

export function sqlClient(url: string): SqlClient {
  return isLocalDatabase(url) ? asNeonClient(postgres(url)) : neon(url)
}
