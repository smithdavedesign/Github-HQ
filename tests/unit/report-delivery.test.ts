import { describe, expect, it } from 'vitest'
import { cycleLogEntry, emailFailureReason, isCycleLog } from '../../factory/lib/report'

describe('morning report email failures', () => {
  it('a timeout says so instead of logging nothing (2026-10-06)', () => {
    expect(emailFailureReason({ code: null, output: '', timedOut: true })).toBe('no answer from Gmail within 60 s (no network?)')
  })
  it('a silent non-zero exit still gives a reason', () => {
    expect(emailFailureReason({ code: 1, output: '  \n', timedOut: false })).toBe('himalaya exited 1 with no output')
  })
  it('otherwise the last two lines of output', () => {
    expect(emailFailureReason({ code: 1, output: 'connecting\nError: cannot authenticate\n  invalid credentials  \n', timedOut: false }))
      .toBe('Error: cannot authenticate | invalid credentials')
  })
})

describe('cycle logs the morning report counts', () => {
  it('recognises the worker\'s log names and the old launchd calendar\'s', () => {
    expect(isCycleLog('cycle-20261007T050500-bfaceaca.log')).toBe(true)
    expect(isCycleLog('cycle-20261006-160505.log')).toBe(true)
    expect(isCycleLog('report-20261006-065303.log')).toBe(false)
    expect(isCycleLog('cycle-20261007T050500-bfaceaca.log.bak')).toBe(false)
  })
  it('reads the worker header, which names the run', () => {
    expect(cycleLogEntry('=== cycle 2026-10-07T05:05:00.629Z run bfaceaca-5bbe-471c-a682-5ca9774ff1a1 ===\n…\n::result::{}\n=== exit 0 ===\n'))
      .toEqual({ at: '2026-10-07T05:05:00.629Z', exit: 0 })
  })
  it('reads the launchd header, and a cycle still running has no exit', () => {
    expect(cycleLogEntry('=== cycle 2026-10-06T23:05:00Z ===\n=== exit 3 ===')).toEqual({ at: '2026-10-06T23:05:00Z', exit: 3 })
    expect(cycleLogEntry('=== cycle 2026-10-06T23:05:00Z ===\n[factory] cloning')).toEqual({ at: '2026-10-06T23:05:00Z', exit: null })
    expect(cycleLogEntry('no header')).toBeNull()
  })
})
