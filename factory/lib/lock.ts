import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

/**
 * One factory process at a time. The scout restarts LiteLLM, which drops any
 * in-flight agent request (an Aider run hung for 15 minutes that way), and two
 * cycles would race on the ledger and on PRs.
 */
export function acquireLock(home: string, owner: string): () => void {
  mkdirSync(home, { recursive: true })
  const file = path.join(home, 'factory.lock')
  if (existsSync(file)) {
    const { pid, owner: holder, at } = JSON.parse(readFileSync(file, 'utf8')) as { pid: number; owner: string; at: string }
    if (isAlive(pid)) throw new Error(`another factory process is running (${holder}, pid ${pid}, since ${at})`)
  }
  writeFileSync(file, JSON.stringify({ pid: process.pid, owner, at: new Date().toISOString() }))
  const release = () => {
    try {
      const cur = JSON.parse(readFileSync(file, 'utf8')) as { pid: number }
      if (cur.pid === process.pid) rmSync(file)
    } catch {
      // already gone
    }
  }
  process.once('exit', release)
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => { release(); process.exit(130) })
  return release
}

/** Who holds the factory lock right now ("run 2026…-ab12, pid 123"), or null when it's free or stale. */
export function lockHolder(home: string): string | null {
  const file = path.join(home, 'factory.lock')
  if (!existsSync(file)) return null
  try {
    const { pid, owner } = JSON.parse(readFileSync(file, 'utf8')) as { pid: number; owner: string }
    return isAlive(pid) ? `${owner}, pid ${pid}` : null
  } catch {
    return null
  }
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}
