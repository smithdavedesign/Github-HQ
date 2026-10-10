import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BRIEF_END, BRIEF_START, systemBrief, withBrief, writeOpenClawBrief } from '../../factory/context/brief'
import { buildIndex } from '../../factory/context/index'

const now = new Date('2026-10-10T20:00:00Z')
const index = buildIndex([{ id: 'repo:a', source: 'repo', dataClass: 'public', title: 'a', text: '', tags: ['focus', 'mrr:4.99'] }], now)

describe('system brief for OpenClaw agents', () => {
  it('carries the goal, the rules, what is failing, the ideas in flight, and how to look things up', () => {
    const b = systemBrief({ index, now, failingNow: [{ fingerprint: 'factory:backup:launchd', message: 'not loaded' }],
      ideas: [{ slug: 'permitly', title: 'permitly — STR permits', stage: 'validate', review: { verdict: 'validate', score: 6 }, signals: { views: 2, uniqueVisitors: 1, signups: 0 }, page: { url: 'https://p/permitly/' } },
        { slug: 'x', title: 'X', stage: 'pass' }] })
    expect(b.startsWith(BRIEF_START) && b.endsWith(BRIEF_END)).toBe(true)
    expect(b).toMatch(/products people use and pay for/)
    expect(b).toMatch(/Never touch financial data/)
    expect(b).toMatch(/\*\*Failing right now \(1\):\*\* factory:backup:launchd — not loaded/)
    expect(b).toMatch(/permitly \(validate, review validate 6\/10, 1 visitors \/ 0 signups, page https:\/\/p\/permitly\/\)/)
    expect(b).toMatch(/Passed: 1\./)
    expect(b).toMatch(/bin\/context search/)
    expect(b).toMatch(/Focus: a\. Total MRR: \$4\.99/)
    expect(systemBrief({ index: null, ideas: [], failingNow: [], now })).toMatch(/\*\*Failing right now:\*\* nothing\./)
  })
  it('replaces its own block in AGENTS.md and leaves the rest alone; appends when missing', () => {
    const b1 = `${BRIEF_START}\nold\n${BRIEF_END}`
    const doc = `# AGENTS\nintro\n\n${b1}\n\n## Later section\nkeep me\n`
    const out = withBrief(doc, `${BRIEF_START}\nnew\n${BRIEF_END}`)
    expect(out).toBe(`# AGENTS\nintro\n\n${BRIEF_START}\nnew\n${BRIEF_END}\n\n## Later section\nkeep me\n`)
    expect(withBrief('# AGENTS\n', `${BRIEF_START}\nx\n${BRIEF_END}`)).toBe(`# AGENTS\n\n${BRIEF_START}\nx\n${BRIEF_END}\n`)
  })
  it('writes into each OpenClaw agent that exists, only when it changed', () => {
    const home = mkdtempSync(path.join(tmpdir(), 'oc-'))
    mkdirSync(path.join(home, '.openclaw', 'workspace-companion'), { recursive: true })
    writeFileSync(path.join(home, '.openclaw', 'workspace-companion', 'AGENTS.md'), '# AGENTS\n')
    const brief = `${BRIEF_START}\nhello\n${BRIEF_END}`
    expect(writeOpenClawBrief(brief, home)).toHaveLength(1)
    expect(readFileSync(path.join(home, '.openclaw', 'workspace-companion', 'AGENTS.md'), 'utf8')).toMatch(/hello/)
    expect(writeOpenClawBrief(brief, home)).toHaveLength(0) // unchanged: no write
  })
})
