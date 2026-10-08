import { FACTORY_STALE_AFTER_HOURS, type FactoryActivity } from './freshness'

export type FactoryState = 'running' | 'idle' | 'paused' | 'not-set-up'

/**
 * One word for the sidebar's factory dot, from the same automation_runs the idle banner reads:
 * running = finished a cycle or request within the banner's window; paused = the newest skipped
 * run says PAUSE; idle = nothing finished in that window; not-set-up = the worker never ran.
 */
export function factoryStatus(a: FactoryActivity, now: Date, staleAfterHours = FACTORY_STALE_AFTER_HOURS): { state: FactoryState; label: string; detail: string } {
  if (!a.firstRunAt) return { state: 'not-set-up', label: 'Factory not set up', detail: 'The worker has never run (bash factory/bin/install-launchd.sh).' }
  if (a.skipReason && /paus/i.test(a.skipReason)) return { state: 'paused', label: 'Factory paused', detail: a.skipReason }
  const since = a.lastWorkAt ?? a.firstRunAt
  const hours = Math.floor((now.getTime() - since.getTime()) / 3_600_000)
  if (a.lastWorkAt && hours < staleAfterHours) {
    return { state: 'running', label: 'Factory running', detail: `Last cycle or request finished ${hours < 1 ? 'under an hour' : `${hours} h`} ago.` }
  }
  return { state: 'idle', label: `Factory idle ${hours} h`, detail: a.skipReason ? `Recent runs skipped: ${a.skipReason}` : 'No cycle or request finished recently. See the Agents page.' }
}
