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
  /** Ceiling across all cycles in a local day (the morning target is 3–8 PRs). */
  maxPrsPerDay: number
  /**
   * Repos with this branch get factory PRs targeted at it instead of the default branch
   * (RepoHQ's policy: autonomous branches → integration/agent → human-reviewed release → main).
   */
  integrationBranch: string
  /**
   * GitHub Copilot (prepaid seat). MC tier = Copilot CLI as a builder; reviews =
   * Copilot code review requested on every factory PR (the independent Reviewer).
   * Both spend premium requests, so each has a daily cap.
   */
  copilot: { enabled: boolean; model: string; maxTasksPerDay: number; review: boolean; maxReviewsPerDay: number }
  harnessTimeoutMs: number
  /** M0 (local 7B) either finishes fast or not at all. */
  m0TimeoutMs: number
  checkTimeoutMs: number
  /**
   * Where target-repo code (install, checks, the model harness) runs. `docker` (default):
   * a throwaway container per repo with no credentials and allowlisted egress
   * (factory/lib/sandbox.ts). If Docker is down, the cycle is skipped rather than running on
   * the host. `off` runs on the host — only for trusted fixtures (the e2e checks).
   */
  sandbox: SandboxConfig
  /**
   * Promotion ladder (roadmap Phase 75): what each capability may do.
   *   observe → sensed and logged only · report → runs, result goes to the morning report, no PR
   *   pr      → opens draft PRs (for `adversarial-veto`: its FAIL rejects instead of only labelling)
   * New capabilities start at `report`; only the owner promotes them (edit factory.config.json).
   */
  capabilities: Record<Capability, CapabilityStage>
  judge: {
    /** Advisory "prove this should NOT merge" pass after the deterministic judge (Phase 77). */
    adversarial: { enabled: boolean; timeoutMs: number; reviewers: Partial<Record<ModelTier, string>> }
  }
  /** Optional RepoHQ sink — mirrors attempts into portfolio_events. */
  repohq: { databaseUrl: string | null; userId: string | null }
}

export type CapabilityStage = 'observe' | 'report' | 'pr'

export const CAPABILITIES = [
  'fix-types', 'fix-lint', 'fix-tests', 'lint-autofix', 'deps-audit', 'docs-readme',
  'red-ci', 'security-alerts', 'adversarial-veto',
] as const
export type Capability = typeof CAPABILITIES[number]

export const DEFAULT_CAPABILITIES: Record<Capability, CapabilityStage> = {
  // Proven: verified fixes merged in the first nights.
  'fix-types': 'pr', 'fix-lint': 'pr', 'fix-tests': 'pr', 'lint-autofix': 'pr', 'deps-audit': 'pr', 'docs-readme': 'pr',
  // New (Phases 77–78): earn promotion with evidence first.
  'red-ci': 'report', 'security-alerts': 'report', 'adversarial-veto': 'report',
}

/** Builder tier → reviewer alias from a different model family (local = Qwen; free-agent = Nemotron → Cohere → Gemini). */
export const DEFAULT_REVIEWERS: Partial<Record<ModelTier, string>> = {
  M0: 'free-agent', M1: 'local-qwen3', MC: 'local-qwen3', M2: 'local-qwen3',
}

export interface SandboxConfig {
  mode: 'docker' | 'off'
  /** Image repositories; the tag is a hash of the Dockerfile, so edits rebuild automatically. */
  workerImage: string
  egressImage: string
  cpus: number
  /** Docker memory limit (swap is capped at the same value). */
  memory: string
  pidsLimit: number
  /** The worker container exits after this long whatever happens (its PID 1 is a timed sleep). */
  lifetimeMs: number
  /** Hostnames the worker may reach through the egress proxy (package registries). */
  allowHosts: string[]
}

export const DEFAULT_SANDBOX: SandboxConfig = {
  mode: 'docker',
  workerImage: 'repohq-factory-worker',
  egressImage: 'repohq-factory-egress',
  cpus: 4,
  memory: '4g',
  pidsLimit: 1024,
  lifetimeMs: 90 * 60_000,
  allowHosts: ['registry.npmjs.org', 'registry.yarnpkg.com'],
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
    // MC is a Copilot CLI model name, not a LiteLLM alias. gpt-5-mini is an included
    // (0x premium) model on paid Copilot plans; set copilot.model for a stronger one.
    models: { M0: 'local-agent', M1: 'free-agent', MC: json.copilot?.model ?? 'gpt-5-mini', M2: 'cloud-smart', ...json.models },
    monthlyBudgetUsd: num(env.FACTORY_MONTHLY_BUDGET_USD, json.monthlyBudgetUsd ?? 0),
    m2EstimateUsd: json.m2EstimateUsd ?? 0.5,
    m2PricePerMTok: json.m2PricePerMTok ?? { input: 3, output: 15 },
    maxPrsPerCycle: num(env.FACTORY_MAX_PRS, json.maxPrsPerCycle ?? 1),
    maxPrsPerDay: json.maxPrsPerDay ?? 8,
    integrationBranch: json.integrationBranch ?? 'integration/agent',
    copilot: {
      enabled: json.copilot?.enabled ?? true,
      model: json.copilot?.model ?? 'gpt-5-mini',
      maxTasksPerDay: json.copilot?.maxTasksPerDay ?? 6,
      review: json.copilot?.review ?? true,
      maxReviewsPerDay: json.copilot?.maxReviewsPerDay ?? 8,
    },
    harnessTimeoutMs: json.harnessTimeoutMs ?? 15 * 60_000,
    m0TimeoutMs: json.m0TimeoutMs ?? 4 * 60_000,
    checkTimeoutMs: json.checkTimeoutMs ?? 8 * 60_000,
    sandbox: {
      ...DEFAULT_SANDBOX,
      ...json.sandbox,
      mode: env.FACTORY_SANDBOX === 'off' ? 'off' : json.sandbox?.mode ?? DEFAULT_SANDBOX.mode,
    },
    capabilities: { ...DEFAULT_CAPABILITIES, ...json.capabilities },
    judge: {
      adversarial: {
        enabled: json.judge?.adversarial?.enabled ?? true,
        timeoutMs: json.judge?.adversarial?.timeoutMs ?? 180_000,
        reviewers: { ...DEFAULT_REVIEWERS, ...json.judge?.adversarial?.reviewers },
      },
    },
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
