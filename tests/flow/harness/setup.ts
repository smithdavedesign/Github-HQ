/**
 * Vitest setup for the flow suite: serve `*.neon.local` from the local Postgres in this process
 * too, so app code (src/lib/db over the Neon HTTP driver) runs against the test database.
 */
import { createRequire } from 'node:module'
import { FLOW } from './flow'

process.env.NEON_LOCAL_PG_URL = FLOW.pgServerUrl
createRequire(import.meta.url)('./neon-local.cjs')
