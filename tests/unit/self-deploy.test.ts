import { describe, it, expect } from 'vitest'
import { checksVerdict, deployDecision, touchesDeployed } from '../../factory/lib/self-deploy'

const ok = { name: 'CI', status: 'completed', conclusion: 'success' }
const base = { deployed: 'aaaaaaa1', target: 'bbbbbbb2' }

describe('self-deploy', () => {
  it('deploys a green main that changed factory code', () => {
    expect(deployDecision({ ...base, changed: ['factory/system/collector.ts', 'docs/x.md'], checks: [ok] }).action).toBe('deploy')
  })
  it('does nothing when up to date or only docs and pages changed', () => {
    expect(deployDecision({ deployed: 'a', target: 'a', changed: [], checks: [] }).action).toBe('none')
    expect(deployDecision({ ...base, changed: ['docs/logging.md', 'src/app/page.tsx'], checks: [ok] }).action).toBe('none')
  })
  it('waits for running checks and holds a red main', () => {
    expect(deployDecision({ ...base, changed: ['package-lock.json'], checks: [ok, { name: 'Build', status: 'in_progress', conclusion: null }] }).action).toBe('wait')
    expect(deployDecision({ ...base, changed: ['package-lock.json'], checks: [] }).action).toBe('wait')
    const red = deployDecision({ ...base, changed: ['src/lib/ideas/idea-utils.ts'], checks: [ok, { name: 'Build', status: 'completed', conclusion: 'failure' }] })
    expect(red).toMatchObject({ action: 'hold', reason: expect.stringContaining('Build failed') })
  })
  it('counts skipped and neutral checks as passing', () => {
    expect(checksVerdict([ok, { name: 'x', status: 'completed', conclusion: 'skipped' }, { name: 'y', status: 'completed', conclusion: 'neutral' }]).verdict).toBe('green')
  })
  it('knows what the deployed checkout runs', () => {
    expect(touchesDeployed(['mcp/server.ts', 'package.json', 'src/components/a.tsx', 'tests/unit/a.test.ts'])).toEqual(['mcp/server.ts', 'package.json'])
  })
})
