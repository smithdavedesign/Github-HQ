/**
 * The factory deploys itself (factory/bin/self-deploy.ts, launchd com.repohq.factory.deploy every 10 minutes).
 * Until 2026-10-19 a merge reached ~/.repohq-factory/app only when someone ran install-launchd.sh: #125 and #126
 * merged and never ran, so the morning email and the collector ran #124's code for two days.
 *
 * A new origin/main is deployed when it changes code the deployed checkout runs (DEPLOY_PATHS) and every check on
 * that commit is green. Docs-only merges are left for the next code change; a red or pending main waits.
 */
import { checkState, type CheckLike } from './automerge'

/** What the deployed checkout runs: the factory, the MCP server, the app code it imports, its dependencies. */
export const DEPLOY_PATHS = ['factory/', 'mcp/', 'src/lib/', 'package.json', 'package-lock.json']

export function touchesDeployed(files: string[]): string[] {
  return files.filter(f => DEPLOY_PATHS.some(p => (p.endsWith('/') ? f.startsWith(p) : f === p)))
}

export type ChecksVerdict = 'green' | 'pending' | 'red'

/** Every check on the commit: green when all passed, red when one failed, else pending (none yet counts as pending). */
export function checksVerdict(checks: CheckLike[]): { verdict: ChecksVerdict; failed: string[] } {
  if (!checks.length) return { verdict: 'pending', failed: [] }
  const states = checks.map(c => ({ name: c.name ?? c.context ?? 'a check', s: checkState(c) }))
  const failed = states.filter(x => x.s === 'fail').map(x => x.name)
  if (failed.length) return { verdict: 'red', failed }
  return { verdict: states.some(x => x.s === 'pending') ? 'pending' : 'green', failed: [] }
}

export type DeployAction = 'none' | 'wait' | 'hold' | 'deploy'

export function deployDecision(input: { deployed: string; target: string; changed: string[]; checks: CheckLike[] }): { action: DeployAction; reason: string } {
  const { deployed, target, changed, checks } = input
  if (deployed === target) return { action: 'none', reason: 'up to date' }
  const touched = touchesDeployed(changed)
  if (!touched.length) return { action: 'none', reason: 'main moved, but nothing the factory runs changed' }
  const { verdict, failed } = checksVerdict(checks)
  if (verdict === 'pending') return { action: 'wait', reason: `checks on ${target.slice(0, 7)} are still running` }
  if (verdict === 'red') return { action: 'hold', reason: `${failed.slice(0, 3).join(', ')} failed on ${target.slice(0, 7)}` }
  return { action: 'deploy', reason: `${touched.length} factory file${touched.length === 1 ? '' : 's'} changed (${touched.slice(0, 3).join(', ')})` }
}
