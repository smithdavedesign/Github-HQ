/**
 * The factory deploys itself: launchd com.repohq.factory.deploy runs this every 10 minutes from the deployed
 * checkout (~/.repohq-factory/app). It fetches main from GitHub (launchd can't read the owner's ~/Documents clone),
 * and when main changed code the factory runs and every check on it is green, it runs install-launchd.sh for that
 * commit (factory/lib/self-deploy.ts). The installer waits for a running factory job before restarting the worker.
 *
 *   npm run factory:self-deploy -- [--dry-run]
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { deployDecision, type DeployAction } from '../lib/self-deploy'
import { emitEvent } from '../system/events'
import type { CheckLike } from '../lib/automerge'

const REPO = 'smithdavedesign/Github-HQ'
const APP = path.resolve(__dirname, '../..')
const STATE = path.join(homedir(), '.repohq-factory', 'self-deploy.json')
const dryRun = process.argv.includes('--dry-run')

const git = (...args: string[]) => execFileSync('git', ['-C', APP, ...args], { encoding: 'utf8', timeout: 120_000 }).trim()

function checksOn(sha: string): CheckLike[] {
  const out = execFileSync('gh', ['api', `repos/${REPO}/commits/${sha}/check-runs?per_page=100`, '--jq', '[.check_runs[] | {name, status, conclusion}]'], { encoding: 'utf8', timeout: 60_000 })
  return JSON.parse(out) as CheckLike[]
}

/** The last thing reported, so a wait or a hold is logged once per commit, not every 10 minutes. */
function lastReport(): { sha?: string; action?: DeployAction | 'failed' } {
  try { return JSON.parse(readFileSync(STATE, 'utf8')) } catch { return {} }
}
function saveReport(sha: string, action: DeployAction | 'failed') {
  mkdirSync(path.dirname(STATE), { recursive: true })
  writeFileSync(STATE, JSON.stringify({ sha, action, at: new Date().toISOString() }) + '\n')
}

/** Check out `sha` and install its dependencies. */
function prepare(sha: string): { ok: true } | { ok: false; error: string } {
  try {
    git('checkout', '-q', '--detach', sha)
    execFileSync('npm', ['ci', '--no-audit', '--no-fund', '--silent'], { cwd: APP, stdio: 'pipe', timeout: 15 * 60_000 })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String((e as { stderr?: Buffer }).stderr?.toString() || (e as Error).message).trim().split('\n').slice(-2).join(' · ').slice(0, 300) }
  }
}

function main() {
  if (existsSync(path.join(homedir(), '.repohq-factory', 'PAUSE'))) return console.log('paused')
  git('fetch', '-q', `https://github.com/${REPO}.git`, 'main')
  const target = git('rev-parse', 'FETCH_HEAD')
  const deployed = git('rev-parse', 'HEAD')
  const changed = deployed === target ? [] : git('diff', '--name-only', deployed, target).split('\n').filter(Boolean)
  const checks = deployed === target ? [] : checksOn(target)
  const d = deployDecision({ deployed, target, changed, checks })
  console.log(`${d.action}: ${d.reason}`)
  const last = lastReport()
  const fresh = last.sha !== target || last.action !== d.action
  if (d.action === 'none') return
  if (d.action !== 'deploy') {
    if (fresh) {
      if (d.action === 'hold') emitEvent({ system: 'factory', component: 'self-deploy', event: 'deploy', status: 'info', message: `not deploying ${target.slice(0, 7)}: ${d.reason}` })
      saveReport(target, d.action)
    }
    return
  }
  if (last.sha === target && last.action === 'failed') return console.log(`held: ${target.slice(0, 7)} failed to deploy; waiting for main to move`)
  if (dryRun) return
  // A running factory job keeps its checkout: try again in 10 minutes rather than swap code under it.
  if (spawnSync('pgrep', ['-f', 'factory/run[.]ts --scheduled']).status === 0) return console.log('a factory job is running: next time')
  // The part that can fail (the checkout, npm ci) runs before the installer stops any job, and is undone if it
  // fails, so a broken deploy leaves the factory running the code it had.
  const prepared = prepare(target)
  if (!prepared.ok) {
    prepare(deployed)
    emitEvent({ system: 'factory', component: 'self-deploy', event: 'deploy', status: 'fail', message: `deploying ${target.slice(0, 7)} failed before anything stopped, still on ${deployed.slice(0, 7)}: ${prepared.error}` })
    saveReport(target, 'failed')
    process.exitCode = 1
    return
  }
  const r = spawnSync('bash', [path.join(APP, 'factory/bin/install-launchd.sh')], {
    cwd: APP, encoding: 'utf8', timeout: 45 * 60_000,
    env: { ...process.env, FACTORY_DEPLOY_SHA: target, FACTORY_SELF_DEPLOY: '1' },
  })
  const tail = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split('\n').slice(-4).join(' · ').slice(0, 600)
  const ok = r.status === 0
  emitEvent({ system: 'factory', component: 'self-deploy', event: 'deploy', status: ok ? 'ok' : 'fail',
    message: ok ? `deployed ${target.slice(0, 7)}: ${d.reason}` : `deploying ${target.slice(0, 7)} failed (exit ${r.status ?? r.signal}): ${tail}`,
    data: { from: deployed.slice(0, 12), to: target.slice(0, 12) } })
  // A failed install is held until main moves again, not retried every 10 minutes.
  saveReport(target, ok ? 'deploy' : 'failed')
  if (!ok) process.exitCode = 1
}

try { main() } catch (e) {
  emitEvent({ system: 'factory', component: 'self-deploy', event: 'deploy', status: 'fail', message: `self-deploy couldn't run: ${String((e as Error).message).slice(0, 300)}` })
  process.exitCode = 1
}
