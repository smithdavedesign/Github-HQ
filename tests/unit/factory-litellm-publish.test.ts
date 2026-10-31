import { describe, it, expect } from 'vitest'
import { commitStackConfig } from '../../factory/lib/litellm-ops'
import type { FactoryConfig } from '../../factory/lib/config'
import type { ProcOptions, ProcResult } from '../../factory/lib/proc'
import type { emitEvent } from '../../factory/system/events'

const cfg = { litellm: { configPath: '/stack/litellm/config.yaml' } } as unknown as FactoryConfig
const NOW = new Date('2026-10-31T12:34:56Z')
const PR = 'https://github.com/o/ai-stack/pull/49'
const ok = (output = ''): ProcResult => ({ code: 0, output, durationMs: 1, timedOut: false })
const bad = (output = 'boom'): ProcResult => ({ code: 1, output, durationMs: 1, timedOut: false })

/** A fake runner: `fail` maps a command fragment (e.g. "push") to the result it should return. */
function harness(fail: Record<string, ProcResult> = {}) {
  const calls: string[] = []
  const events: Parameters<typeof emitEvent>[0][] = []
  const run = async (cmd: string, args: string[], _opts?: ProcOptions): Promise<ProcResult> => {
    const line = [cmd, ...args.filter(a => !a.startsWith('credential.helper') && a !== '-c')].join(' ')
    calls.push(line)
    for (const [k, r] of Object.entries(fail)) if (line.includes(k)) return r
    if (line.includes('symbolic-ref')) return ok('master\n')
    if (line.includes('pr create')) return ok(`${PR}\n`)
    return ok()
  }
  return { calls, events, deps: { run, emit: (e: Parameters<typeof emitEvent>[0]) => { events.push(e) }, now: () => NOW } }
}

describe('commitStackConfig', () => {
  it('commits locally, pushes a branch, opens a PR and merges it with a merge commit', async () => {
    const h = harness()
    const r = await commitStackConfig(cfg, 'factory scout: pool x', h.deps)
    expect(r).toEqual({ status: 'merged', prUrl: PR })
    expect(h.calls).toContain('git -C /stack commit -m factory scout: pool x -- litellm/config.yaml')
    expect(h.calls).toContain('git -C /stack merge-base --is-ancestor HEAD~1 origin/master')
    expect(h.calls).toContain('git -C /stack push -q origin HEAD:refs/heads/factory/scout-20261031123456')
    expect(h.calls.some(c => c.startsWith('gh pr create --base master --head factory/scout-20261031123456'))).toBe(true)
    expect(h.calls).toContain(`gh pr merge ${PR} --merge`)
    // Never force, never the base branch, never a branch delete.
    expect(h.calls.join('\n')).not.toMatch(/--force|-f\b|--delete|HEAD:refs\/heads\/master/)
    expect(h.events).toMatchObject([{ system: 'repohq', component: 'factory', event: 'scout-push', status: 'ok' }])
  })

  it('does nothing outside a git repo, and stops quietly when there is nothing to commit', async () => {
    const a = harness({ 'rev-parse': bad() })
    expect(await commitStackConfig(cfg, 'm', a.deps)).toMatchObject({ status: 'skipped' })
    expect(a.calls).toHaveLength(1)
    const b = harness({ ' commit ': bad('nothing to commit') })
    expect(await commitStackConfig(cfg, 'm', b.deps)).toMatchObject({ status: 'skipped' })
    expect(b.calls.some(c => c.includes('push'))).toBe(false)
    expect(b.events).toEqual([])
  })

  it.each([
    ['push', 'push failed'],
    ['pr create', 'PR create failed'],
    ['pr merge', 'merge failed'],
    ['merge-base', "commits origin doesn't"],
  ])('when %s fails, logs scout-push fail and leaves the local commit', async (step, reason) => {
    const h = harness({ [step]: bad() })
    const r = await commitStackConfig(cfg, 'm', h.deps)
    expect(r.status).toBe('left-local')
    expect(r.reason).toContain(reason)
    expect(h.events).toHaveLength(1)
    expect(h.events[0]).toMatchObject({ system: 'repohq', component: 'factory', event: 'scout-push', status: 'fail' })
    expect(h.calls.some(c => /reset|revert/.test(c))).toBe(false)
    if (step === 'merge-base') expect(h.calls.some(c => c.includes('push'))).toBe(false)
  })
})
