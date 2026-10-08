/**
 * Apply the factory's idempotent SQL migrations (factory/sql/*.sql, in name order) to the
 * RepoHQ database. Additive and safe to re-run: every statement is IF NOT EXISTS.
 *   npm run factory:migrate
 * DB URL: FACTORY_DATABASE_URL, else DATABASE_URL from RepoHQ's .env.local (never printed).
 */
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { neon } from '@neondatabase/serverless'
import { readEnvVar } from '../lib/config'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..')
const DIR = path.join(ROOT, 'factory', 'sql')

/** Split on top-level `;` line ends; a `DO $$ … END $$;` block stays one statement. */
export function splitStatements(sqlText: string): string[] {
  const out: string[] = []
  let cur: string[] = []
  let inDo = false
  for (const line of sqlText.split('\n')) {
    if (!cur.length && (line.startsWith('--') || !line.trim())) continue
    cur.push(line)
    if (/^DO \$\$/.test(line)) inDo = true
    const ends = inDo ? /^END \$\$;\s*$/.test(line) : /;\s*$/.test(line)
    if (ends) { out.push(cur.join('\n').trim()); cur = []; inDo = false }
  }
  if (cur.join('').trim()) out.push(cur.join('\n').trim())
  return out
}

async function main() {
  const url = process.env.FACTORY_DATABASE_URL ?? readEnvVar(path.join(ROOT, '.env.local'), 'DATABASE_URL')
  if (!url) throw new Error('no database URL (set FACTORY_DATABASE_URL or DATABASE_URL in .env.local)')
  const sql = neon(url)
  for (const file of readdirSync(DIR).filter(f => f.endsWith('.sql')).sort()) {
    const statements = splitStatements(readFileSync(path.join(DIR, file), 'utf8'))
    for (const s of statements) await sql.query(s)
    console.log(`applied ${file} (${statements.length} statements)`)
  }
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  main().catch(err => { console.error(err instanceof Error ? err.message : err); process.exit(1) })
}
