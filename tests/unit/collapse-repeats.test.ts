import { describe, it, expect } from 'vitest'
import { collapseRepeats, repeatKey } from '../../src/lib/feed/collapse'

describe('repeatKey', () => {
  it('ignores numbers, ids and whitespace so the same failure matches itself', () => {
    expect(repeatKey('failed', 'Worker job failed: code 128 at task 4fb84c1e9a')).toBe(repeatKey('failed', 'Worker job  failed: code 129 at task 0a8c960b11'))
  })
  it('keeps different messages and repos apart', () => {
    expect(repeatKey('failed', 'RepoHQ', 'git clone')).not.toBe(repeatKey('failed', 'Open-Travel', 'git clone'))
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
