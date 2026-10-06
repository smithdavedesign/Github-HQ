import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { FactoryConfig } from './config'
import { applyManagedBlocks, type ManagedModel } from './litellm-config'
import { run } from './proc'

/** Rewrite the managed blocks (backup kept next to the config), restart LiteLLM, wait for health. */
export async function applyLiteLLMModels(cfg: FactoryConfig, models: ManagedModel[], fallbacks: Record<string, string[]>): Promise<void> {
  const p = cfg.litellm.configPath
  const before = readFileSync(p, 'utf8')
  const after = applyManagedBlocks(before, models, fallbacks)
  if (after === before) return
  copyFileSync(p, `${p}.factory-backup`)
  writeFileSync(p, after)
  const ok = await restartLiteLLM(cfg)
  if (!ok) {
    // Roll back so the rest of the stack keeps working.
    writeFileSync(p, before)
    await restartLiteLLM(cfg)
    throw new Error('LiteLLM did not come back healthy after config change — rolled back')
  }
}

export async function restartLiteLLM(cfg: FactoryConfig): Promise<boolean> {
  await run('docker', ['compose', '-f', cfg.litellm.composeFile, 'restart'], { timeoutMs: 120_000 })
  return waitHealthy(cfg)
}

export async function waitHealthy(cfg: FactoryConfig, timeoutMs = 90_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`${cfg.litellm.url}/v1/models`, { headers: { Authorization: `Bearer ${cfg.litellm.key}` } })
      if (r.ok) return true
    } catch {
      // not up yet
    }
    await new Promise(res => setTimeout(res, 3000))
  }
  return false
}

export async function listAliases(cfg: FactoryConfig): Promise<string[]> {
  const r = await fetch(`${cfg.litellm.url}/v1/models`, { headers: { Authorization: `Bearer ${cfg.litellm.key}` } })
  if (!r.ok) throw new Error(`LiteLLM /v1/models → ${r.status}`)
  const j = (await r.json()) as { data?: { id: string }[] }
  return (j.data ?? []).map(m => m.id)
}

/** Commit the config change in ~/ai-stack if it is a git repo (no-op otherwise). */
export async function commitStackConfig(cfg: FactoryConfig, message: string): Promise<void> {
  const dir = path.resolve(path.dirname(cfg.litellm.configPath), '..')
  const rel = path.relative(dir, cfg.litellm.configPath)
  const inside = await run('git', ['-C', dir, 'rev-parse', '--is-inside-work-tree'], { timeoutMs: 10_000 })
  if (inside.code !== 0) return
  await run('git', ['-C', dir, 'add', rel], { timeoutMs: 10_000 })
  await run('git', ['-C', dir, 'commit', '-m', message, '--', rel], { timeoutMs: 10_000 })
}
