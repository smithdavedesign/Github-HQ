import { readFileSync, existsSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import type { ModelTier } from '../../src/lib/agents/model-router'

export interface FactoryConfig {
  /** State dir: ledger, workspaces, logs, PAUSE kill-switch. */
  home: string
  /** owner/name allowlist — the factory never touches a repo that isn't listed. */
  repos: string[]
  /** Private repos explicitly allowed to use free cloud models (M1). */
  allowFreeCloud: string[]
  litellm: { url: string; key: string; configPath: string; composeFile: string }
  /** LiteLLM aliases per tier. */
  models: Record<ModelTier, string>
  /** Paid (M2) budget. 0 = paid tier disabled — the default. */
  monthlyBudgetUsd: number
  /** Conservative per-task estimate used to gate M2 before it runs. */
  m2EstimateUsd: number
  /** $/M tokens for computing M2 cost from Claude Code usage (alias names have no price in Claude Code). */
  m2PricePerMTok: { input: number; output: number }
  maxPrsPerCycle: number
  harnessTimeoutMs: number
  /** M0 (local 7B) either finishes fast or not at all. */
  m0TimeoutMs: number
  checkTimeoutMs: number
  /** Optional RepoHQ sink — mirrors attempts into portfolio_events. */
  repohq: { databaseUrl: string | null; userId: string | null }
}

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')

export function loadConfig(env: NodeJS.ProcessEnv = process.env): FactoryConfig {
  const file = env.FACTORY_CONFIG ?? path.join(ROOT, 'factory.config.json')
  const json = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Partial<FactoryConfig>) : {}
  const home = env.FACTORY_HOME ?? path.join(homedir(), '.repohq-factory')
  const num = (v: string | undefined, d: number) => (v !== undefined && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : d)

  return {
    home,
    repos: json.repos ?? [],
    allowFreeCloud: json.allowFreeCloud ?? [],
    litellm: {
      url: env.FACTORY_LITELLM_URL ?? 'http://localhost:4000',
      key: env.FACTORY_LITELLM_KEY ?? 'sk-local-ai',
      configPath: env.FACTORY_LITELLM_CONFIG ?? path.join(homedir(), 'ai-stack/litellm/config.yaml'),
      composeFile: env.FACTORY_LITELLM_COMPOSE ?? path.join(homedir(), 'ai-stack/litellm/docker-compose.yml'),
    },
    models: { M0: 'local-agent', M1: 'free-agent', M2: 'cloud-smart', ...json.models },
    monthlyBudgetUsd: num(env.FACTORY_MONTHLY_BUDGET_USD, json.monthlyBudgetUsd ?? 0),
    m2EstimateUsd: json.m2EstimateUsd ?? 0.5,
    m2PricePerMTok: json.m2PricePerMTok ?? { input: 3, output: 15 },
    maxPrsPerCycle: num(env.FACTORY_MAX_PRS, json.maxPrsPerCycle ?? 1),
    harnessTimeoutMs: json.harnessTimeoutMs ?? 15 * 60_000,
    m0TimeoutMs: json.m0TimeoutMs ?? 4 * 60_000,
    checkTimeoutMs: json.checkTimeoutMs ?? 8 * 60_000,
    repohq: {
      // Reuse RepoHQ's own .env.local rather than copying the DB secret elsewhere.
      databaseUrl: env.FACTORY_USER_ID ? env.FACTORY_DATABASE_URL ?? readEnvVar(path.join(ROOT, '..', '.env.local'), 'DATABASE_URL') : null,
      userId: env.FACTORY_USER_ID ?? null,
    },
  }
}

/** Read one variable from a dotenv file at runtime (value never logged). */
export function readEnvVar(file: string, name: string): string | null {
  if (!existsSync(file)) return null
  const m = new RegExp(`^\\s*${name}\\s*=\\s*["']?([^"'\\n]+?)["']?\\s*$`, 'm').exec(readFileSync(file, 'utf8'))
  return m?.[1] ?? null
}
