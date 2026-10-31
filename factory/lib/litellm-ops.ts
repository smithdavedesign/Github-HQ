import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { FactoryConfig } from './config'
import { applyManagedBlocks, type ManagedModel } from './litellm-config'
import { emitEvent } from '../system/events'
import { GIT_CRED } from './git'
import { run, type ProcResult, type Runner } from './proc'

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

export interface PublishDeps {
  run?: Runner
  emit?: typeof emitEvent
  now?: () => Date
}

export type PublishResult = { status: 'skipped' | 'merged' | 'left-local'; prUrl?: string; reason?: string }

/**
 * Commit the config change in ~/ai-stack and get it to origin (no-op if it isn't a git repo).
 *
 * ~/ai-stack is a live checkout with no CI, so the commit stays on its branch (the running stack
 * reads this file) and also goes up as its own branch + PR, merged straight away with a merge
 * commit. A merge commit keeps the scout's commit as is, so the live checkout stays an ancestor of
 * origin and its next pull fast-forwards. Before this, the commit was never pushed: eb84c58 sat
 * only on the live master for two weeks while origin drifted.
 *
 * Never force-pushes, never pushes the base branch, never deletes a branch. Any failure is logged
 * (repohq/factory/scout-push, which alerts #team-agents) and the local commit is left as it is.
 */
export async function commitStackConfig(cfg: FactoryConfig, message: string, deps: PublishDeps = {}): Promise<PublishResult> {
  const exec = deps.run ?? run
  const emit = deps.emit ?? emitEvent
  const now = deps.now ?? (() => new Date())
  const dir = path.resolve(path.dirname(cfg.litellm.configPath), '..')
  const rel = path.relative(dir, cfg.litellm.configPath)
  const git = (args: string[], timeoutMs = 30_000) => exec('git', ['-C', dir, ...args], { timeoutMs })
  const out = (r: ProcResult) => r.output.trim().split('\n').slice(-3).join(' | ').slice(0, 300)

  const inside = await git(['rev-parse', '--is-inside-work-tree'])
  if (inside.code !== 0) return { status: 'skipped', reason: 'not a git repo' }
  await git(['add', rel])
  const commit = await git(['commit', '-m', message, '--', rel])
  if (commit.code !== 0) return { status: 'skipped', reason: 'nothing to commit' }

  const leave = (reason: string): PublishResult => {
    emit({ system: 'repohq', component: 'factory', event: 'scout-push', status: 'fail', message: `ai-stack config commit left local: ${reason}` })
    return { status: 'left-local', reason }
  }

  const base = (await git(['symbolic-ref', '--short', 'HEAD'])).output.trim()
  if (!base) return leave('detached HEAD')
  const fetched = await git([...GIT_CRED, 'fetch', '-q', 'origin', base], 120_000)
  if (fetched.code !== 0) return leave(`fetch failed: ${out(fetched)}`)
  // Only the scout's own commit may go up: anything else unpushed on the live branch is not ours to publish.
  const clean = await git(['merge-base', '--is-ancestor', 'HEAD~1', `origin/${base}`])
  if (clean.code !== 0) return leave(`${base} has commits origin doesn't; push them first`)

  const branch = `factory/scout-${now().toISOString().slice(0, 19).replace(/[-:T]/g, '')}`
  const pushed = await git([...GIT_CRED, 'push', '-q', 'origin', `HEAD:refs/heads/${branch}`], 180_000)
  if (pushed.code !== 0) return leave(`push failed: ${out(pushed)}`)

  const gh = (args: string[]) => exec('gh', args, { cwd: dir, timeoutMs: 120_000 })
  const body = 'The weekly model scout rewrote the free-model pool in `litellm/config.yaml` (managed blocks only) and restarted LiteLLM; the live checkout already runs this. ai-stack has no CI, so the scout merges this itself.'
  const created = await gh(['pr', 'create', '--base', base, '--head', branch, '--title', message, '--body', body])
  const prUrl = created.output.match(/https:\/\/github\.com\/\S+\/pull\/\d+/)?.[0]
  if (created.code !== 0 || !prUrl) return leave(`branch ${branch} pushed, PR create failed: ${out(created)}`)

  const merged = await gh(['pr', 'merge', prUrl, '--merge'])
  if (merged.code !== 0) return { ...leave(`PR ${prUrl} open, merge failed: ${out(merged)}`), prUrl }
  emit({ system: 'repohq', component: 'factory', event: 'scout-push', status: 'ok', message: `ai-stack config merged: ${prUrl}`, subject: { repo: 'ai-stack', pr: prUrl } })
  return { status: 'merged', prUrl }
}
