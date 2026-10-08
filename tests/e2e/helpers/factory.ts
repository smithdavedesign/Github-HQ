/**
 * Agent HQ (roadmap Phase 81) e2e helpers. The agent launcher, Run Agent buttons and the owner
 * controls on the Agents page render only for the factory's owner (FACTORY_USER_ID, read from
 * .env.local by playwright.config.ts) and only on repos in factory/factory.config.json "repos".
 * The suite signs in as the most recently synced user (tests/setup/auth.setup.ts), so these
 * helpers find repos only when that user is the factory owner — otherwise specs skip.
 */
import { neon } from '@neondatabase/serverless'
import factoryConfig from '../../../factory/factory.config.json'

export const FACTORY_OWNER = process.env.FACTORY_USER_ID ?? ''
export const NOT_FACTORY_OWNER = 'the signed-in e2e user is not FACTORY_USER_ID (set it in .env.local to the account you sign in with)'

const allowlist = new Set(factoryConfig.repos.map(r => r.toLowerCase()))

async function signedInUserRepos(): Promise<{ id: number; name: string; fullName: string }[]> {
  const url = process.env.DATABASE_URL
  if (!url || !FACTORY_OWNER) return []
  const sql = neon(url)
  const [user] = await sql`SELECT id FROM users ORDER BY last_synced_at DESC NULLS LAST LIMIT 1`
  if (!user || user.id !== FACTORY_OWNER) return []
  const rows = await sql`SELECT id, name, full_name FROM repositories WHERE user_id = ${FACTORY_OWNER} ORDER BY id`
  return rows.map(r => ({ id: r.id as number, name: r.name as string, fullName: r.full_name as string }))
}

/** A repo the factory takes requests for (the launcher renders there), or null. */
export async function getFactoryRepo(): Promise<{ id: number; name: string } | null> {
  const repo = (await signedInUserRepos()).find(r => allowlist.has(r.fullName.toLowerCase()))
  return repo ? { id: repo.id, name: repo.name } : null
}

/** A repo of the owner that is NOT on the allowlist (the launcher explains why it's off), or null. */
export async function getNonFactoryRepo(): Promise<{ id: number; name: string } | null> {
  const repo = (await signedInUserRepos()).find(r => !allowlist.has(r.fullName.toLowerCase()))
  return repo ? { id: repo.id, name: repo.name } : null
}
