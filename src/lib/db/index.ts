import { neon } from '@neondatabase/serverless'
import { drizzle } from 'drizzle-orm/neon-http'
import * as schema from './schema'

// Defer the neon() call so the edge bundle can be evaluated during `next build`
// even when DATABASE_URL is absent (e.g. Vercel preview builds before env vars
// are configured). Queries made without a real DATABASE_URL will still fail at
// runtime — but the build itself won't blow up.
function createDb() {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is not set. Add it to your environment variables (Vercel → ' +
        'Project → Settings → Environment Variables).',
    )
  }
  return drizzle(neon(process.env.DATABASE_URL), { schema })
}

let _db: ReturnType<typeof createDb> | undefined

export const db = new Proxy({} as ReturnType<typeof createDb>, {
  get(_t, prop) {
    if (!_db) _db = createDb()
    return (_db as unknown as Record<string | symbol, unknown>)[prop]
  },
  // Auth.js's DrizzleAdapter uses `is(db, PgDatabase)` (instanceof-based) to
  // validate the db instance. Without this trap, `instanceof` falls back to
  // the proxy target's prototype (Object.prototype) and the check fails.
  getPrototypeOf() {
    if (!_db) _db = createDb()
    return Reflect.getPrototypeOf(_db)
  },
})
