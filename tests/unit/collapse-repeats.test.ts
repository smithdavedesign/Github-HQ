import { describe, it, expect } from 'vitest'
import { collapseRepeats, repeatKey } from '../../src/lib/feed/collapse'

describe('repeatKey', () => {
  it('ignores numbers, ids and whitespace so the same failure matches itself', () => {
    expect(repeatKey('failed', 'Worker job failed: code 128 at task 4fb84c1e9a')).toBe(repeatKey('failed', 'Worker job  failed: code 129 at task 0a8c960b11'))
  })
  it('keeps different messages and repos apart', () => {
    expect(repeatKey('failed', 'RepoHQ', 'git clone')).not.toBe(repeatKey('failed', 'Open-Travel', 'git clone'))
    // A numeric part is an id (repo id): kept exactly, so repos 12 and 13 never share a row.
    expect(repeatKey('agent_attempt', 12, 'Fix vulnerable dependencies')).not.toBe(repeatKey('agent_attempt', 13, 'Fix vulnerable dependencies'))
    expect(repeatKey('agent_attempt', 12, 'high+critical 24 → 12')).toBe(repeatKey('agent_attempt', 12, 'high+critical 43 → 17'))
    expect(repeatKey('failed', 'x', 'column "correlation_id" does not exist')).not.toBe(repeatKey('failed', 'x', 'Repository not found'))
  })
})

describe('collapseRepeats', () => {
  it('keeps the newest occurrence in place and counts the rest', () => {
    const log = ['fail A', 'queued B', 'fail A', 'queued B', 'merged C', 'fail A']
    expect(collapseRepeats(log, s => s)).toEqual([
      { item: 'fail A', count: 3 },
      { item: 'queued B', count: 2 },
      { item: 'merged C', count: 1 },
    ])
  })
  it('returns an empty list for no input', () => {
    expect(collapseRepeats([], String)).toEqual([])
  })
})
