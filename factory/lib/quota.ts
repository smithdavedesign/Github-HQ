import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import type { FactoryConfig } from './config'

/**
 * OpenRouter free-model quota. On a $0-credit account the daily cap is small
 * (50 requests/day when this was written), and one Claude Code task uses
 * ~10–30 requests, so M1 work must check what's left before starting rather
 * than discovering a 429 five minutes in.
 */

export interface FreeQuota {
  used: number
  limit: number
  remaining: number
}

/** Requests to reserve before starting an M1 (Claude Code) task. */
export const M1_MIN_REQUESTS = 25
/** Requests one scout eval case may use. */
export const SCOUT_REQUESTS_PER_CASE = 15

/** Runtime-only secret read (PRD §21.6): the key goes into an HTTP header, never into a prompt or log. */
export function openRouterKey(cfg: FactoryConfig, env: NodeJS.ProcessEnv = process.env): string | null {
  if (env.OPENROUTER_API_KEY) return env.OPENROUTER_API_KEY
  const envFile = path.join(path.dirname(cfg.litellm.configPath), '.env')
  if (!existsSync(envFile)) return null
  const m = /^\s*OPENROUTER_API_KEY\s*=\s*["']?([^"'\s]+)/m.exec(readFileSync(envFile, 'utf8'))
  return m?.[1] ?? null
}

export function parseFreeQuota(body: unknown): FreeQuota | null {
  const q = (body as { data?: { free_model_daily_requests?: { used?: number; limit?: number; remaining?: number } } })?.data?.free_model_daily_requests
  if (!q || typeof q.limit !== 'number') return null
  const used = q.used ?? 0
  return { used, limit: q.limit, remaining: Math.max(0, q.remaining ?? q.limit - used) }
}

/** Null when unknown (no key / API down) — callers then proceed and rely on 429 handling. */
export async function freeQuota(cfg: FactoryConfig): Promise<FreeQuota | null> {
  const key = openRouterKey(cfg)
  if (!key) return null
  try {
    const r = await fetch('https://openrouter.ai/api/v1/key', { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20_000) })
    return r.ok ? parseFreeQuota(await r.json()) : null
  } catch {
    return null
  }
}
