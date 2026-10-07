import type { ModelTier } from '../../src/lib/agents/model-router'
import type { FactoryConfig } from './config'
import { run, type Runner } from './proc'

export type HarnessName = 'aider' | 'claude-code' | 'copilot' | 'npm-audit-fix' | 'lint-autofix'

export interface HarnessRequest {
  tier: ModelTier
  /** LiteLLM alias (normally config.models[tier]; the scout passes candidates directly). */
  model: string
  cwd: string
  prompt: string
  /** Files Aider may edit (M0 only — Aider needs explicit targets). */
  files?: string[]
  /** LiteLLM alias for Claude Code's small-model role (background calls). Defaults to `model`. */
  smallModel?: string
  /** Report-only: no Edit tool, and no Bash beyond read-only checks. */
  readOnly?: boolean
  timeoutMs?: number
}

export interface HarnessResult {
  ok: boolean
  harness: HarnessName
  model: string
  output: string
  /** The agent's final answer, when the harness reports one separately (Claude Code). */
  text?: string
  /** Model requests this run spent (Claude Code turns, Aider rounds, one per Copilot prompt). */
  requests: number
  durationMs: number
  inputTokens: number
  outputTokens: number
  costUsd: number
  rateLimited: boolean
  timedOut: boolean
}

/** Tools a fixing agent may use. No commit/push, no network fetch — the factory owns git. */
const FIX_TOOLS = [
  'Read', 'Edit', 'Write', 'Glob', 'Grep',
  'Bash(npm run:*)', 'Bash(npm test:*)', 'Bash(npx tsc:*)', 'Bash(npx eslint:*)',
  'Bash(npx vitest:*)', 'Bash(npx jest:*)', 'Bash(node:*)', 'Bash(git diff:*)', 'Bash(git status:*)', 'Bash(ls:*)',
]
const READ_ONLY_TOOLS = ['Read', 'Glob', 'Grep', 'Write', 'Bash(npm run:*)', 'Bash(npm test:*)', 'Bash(node:*)', 'Bash(ls:*)']
const DENY_TOOLS = ['Bash(git commit:*)', 'Bash(git push:*)', 'Bash(git reset:*)', 'Bash(rm:*)', 'WebFetch', 'WebSearch']

const RATE_LIMIT_RE = /\b429\b|rate[ _-]?limit|too many requests|quota exceeded/i

export function harnessFor(tier: ModelTier): HarnessName {
  if (tier === 'M0') return 'aider'
  if (tier === 'MC') return 'copilot'
  return 'claude-code'
}

/** `runner` = where the agent runs: the host, or a sandbox container (cfg.litellm.url must then be the sandbox's relay). */
export async function runHarness(req: HarnessRequest, cfg: FactoryConfig, runner: Runner = run): Promise<HarnessResult> {
  const h = harnessFor(req.tier)
  if (h === 'aider') return runAider(req, cfg, runner)
  if (h === 'copilot') return runCopilot(req, cfg, runner)
  return runClaudeCode(req, cfg, runner)
}

/** Copilot CLI permissions: deny rules beat allow rules; file access is confined to the cwd by default. */
export function copilotArgs(req: Pick<HarnessRequest, 'model' | 'prompt' | 'readOnly'>): string[] {
  const shellAllow = ['npm:*', 'npx:*', 'node:*', 'ls', 'cat', 'grep', 'find', 'git diff', 'git status', 'git log']
  const shellDeny = ['git push', 'git commit', 'git reset', 'git checkout', 'rm', 'gh:*', 'curl', 'wget', 'npm publish', 'npm install']
  return [
    '-p', req.prompt,
    '--model', req.model,
    '--silent', '--no-ask-user', '--no-auto-update', '--no-color',
    // The built-in GitHub MCP server can write to GitHub — the factory owns git and PRs.
    '--disable-builtin-mcps',
    ...shellAllow.map(c => `--allow-tool=shell(${c})`),
    // Writes stay allowed even for read-only runs: callers verify protected files afterwards.
    '--allow-tool=write',
    ...shellDeny.map(c => `--deny-tool=shell(${c})`),
  ]
}

async function runCopilot(req: HarnessRequest, cfg: FactoryConfig, runner: Runner): Promise<HarnessResult> {
  // The Copilot CLI would sign in with GH_TOKEN when it's set: keep it on your own Copilot login,
  // not the factory's scoped repo token (factory.sh).
  const r = await runner('copilot', copilotArgs(req), { cwd: req.cwd, timeoutMs: req.timeoutMs ?? cfg.harnessTimeoutMs, env: { GH_TOKEN: '' } })
  return {
    ok: r.code === 0 && !r.timedOut,
    harness: 'copilot',
    model: req.model,
    output: r.output,
    durationMs: r.durationMs,
    // Copilot bills premium requests per prompt (× model multiplier), not tokens; the
    // ledger counts MC attempts per day against copilot.maxTasksPerDay instead.
    inputTokens: 0,
    outputTokens: 0,
    costUsd: 0,
    requests: 1,
    // "You have no quota" = monthly premium requests spent: wait for the reset, not a model failure.
    rateLimited: RATE_LIMIT_RE.test(r.output) || /premium request|usage limit|no quota/i.test(r.output),
    timedOut: r.timedOut,
  }
}

async function runAider(req: HarnessRequest, cfg: FactoryConfig, runner: Runner): Promise<HarnessResult> {
  const args = [
    '--model', `openai/${req.model}`,
    // Search/replace edits. Aider's default "whole" format makes the 7B model re-emit
    // entire files, which truncates anything large (a 37KB README came back as 376 tokens).
    '--edit-format', 'diff',
    '--no-git', '--yes-always', '--no-auto-commits', '--no-show-model-warnings',
    // Note: no --no-stream — with LiteLLM→Ollama, Aider's non-streaming path reports "Empty response".
    '--no-check-update', '--no-analytics', '--no-pretty', '--map-tokens', '0',
    '--message', req.prompt,
    ...(req.files ?? []),
  ]
  const r = await runner('aider', args, {
    cwd: req.cwd,
    timeoutMs: req.timeoutMs ?? cfg.harnessTimeoutMs,
    env: aiderEnv(cfg),
  })
  const tokens = /Tokens:\s*([\d.,]+k?)\s*sent,\s*([\d.,]+k?)\s*received/i.exec(r.output)
  return {
    requests: aiderRequests(r.output),
    ok: r.code === 0 && !r.timedOut && !/litellm\.\w*Error|APIConnectionError|Empty response received/i.test(r.output),
    harness: 'aider',
    model: req.model,
    output: r.output,
    durationMs: r.durationMs,
    inputTokens: tokens ? parseTokenCount(tokens[1]) : 0,
    outputTokens: tokens ? parseTokenCount(tokens[2]) : 0,
    costUsd: 0,
    rateLimited: RATE_LIMIT_RE.test(r.output),
    timedOut: r.timedOut,
  }
}

async function runClaudeCode(req: HarnessRequest, cfg: FactoryConfig, runner: Runner): Promise<HarnessResult> {
  const args = [
    '-p', req.prompt,
    '--bare', '--strict-mcp-config',
    '--model', req.model,
    '--output-format', 'json',
    '--permission-mode', 'acceptEdits',
    '--allowedTools', ...(req.readOnly ? READ_ONLY_TOOLS : FIX_TOOLS),
    '--disallowedTools', ...(req.readOnly ? [...DENY_TOOLS, 'Edit'] : DENY_TOOLS),
  ]
  if (req.tier === 'M2') args.push('--max-budget-usd', String(cfg.m2EstimateUsd * 2))

  const r = await runner('claude', args, {
    cwd: req.cwd,
    timeoutMs: req.timeoutMs ?? cfg.harnessTimeoutMs,
    env: claudeCodeEnv(req, cfg),
  })
  const result = parseClaudeResult(r.output)
  const inputTokens = result?.inputTokens ?? 0
  const outputTokens = result?.outputTokens ?? 0
  const costUsd = req.tier === 'M2'
    ? (inputTokens * cfg.m2PricePerMTok.input + outputTokens * cfg.m2PricePerMTok.output) / 1_000_000
    : 0
  return {
    ok: r.code === 0 && !r.timedOut && result !== null && !result.isError,
    harness: 'claude-code',
    model: req.model,
    output: result?.text ? `${result.text}\n---\n${r.output.slice(-4000)}` : r.output,
    text: result?.text,
    requests: result?.turns ?? 0,
    durationMs: r.durationMs,
    inputTokens,
    outputTokens,
    costUsd,
    rateLimited: RATE_LIMIT_RE.test(r.output),
    timedOut: r.timedOut,
  }
}

/** Aider's environment overrides: the OpenAI-compatible LiteLLM endpoint. */
export function aiderEnv(cfg: Pick<FactoryConfig, 'litellm'>): Record<string, string> {
  return { OPENAI_API_BASE: `${cfg.litellm.url}/v1`, OPENAI_API_KEY: cfg.litellm.key }
}

/** Claude Code's environment overrides. Every tier goes through the LiteLLM gateway; --bare reads only ANTHROPIC_API_KEY. */
export function claudeCodeEnv(req: Pick<HarnessRequest, 'model' | 'smallModel'>, cfg: Pick<FactoryConfig, 'litellm'>): Record<string, string> {
  return {
    ANTHROPIC_BASE_URL: cfg.litellm.url,
    ANTHROPIC_API_KEY: cfg.litellm.key,
    ANTHROPIC_AUTH_TOKEN: '',
    ANTHROPIC_DEFAULT_HAIKU_MODEL: req.smallModel ?? req.model,
    ANTHROPIC_SMALL_FAST_MODEL: req.smallModel ?? req.model,
    ANTHROPIC_DEFAULT_SONNET_MODEL: req.model,
    ANTHROPIC_DEFAULT_OPUS_MODEL: req.model,
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
  }
}

/** One "Tokens: … sent, … received" line per model round trip. */
export function aiderRequests(output: string): number {
  return (output.match(/Tokens:\s*[\d.,]+k?\s*sent/gi) ?? []).length
}

export interface ClaudeResultSummary {
  isError: boolean
  text: string
  /** Agent turns = model requests. */
  turns: number
  inputTokens: number
  outputTokens: number
}

/** Parse the final `--output-format json` result object out of mixed stdout/stderr. */
export function parseClaudeResult(output: string): ClaudeResultSummary | null {
  const lines = output.split('\n').filter(l => l.trimStart().startsWith('{') && l.includes('"type":"result"'))
  const last = lines[lines.length - 1]
  if (!last) return null
  try {
    const j = JSON.parse(last.trim()) as {
      is_error?: boolean
      result?: string
      num_turns?: number
      usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }
    }
    const u = j.usage ?? {}
    return {
      isError: j.is_error === true,
      text: j.result ?? '',
      turns: j.num_turns ?? 0,
      inputTokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
      outputTokens: u.output_tokens ?? 0,
    }
  } catch {
    return null
  }
}

/** "651" → 651, "1.2k" → 1200, "12,345" → 12345 */
export function parseTokenCount(s: string): number {
  const clean = s.replace(/,/g, '')
  return clean.endsWith('k') ? Math.round(parseFloat(clean) * 1000) : parseInt(clean, 10) || 0
}
