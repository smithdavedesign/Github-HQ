/**
 * RepoHQ's side of the Agent HQ queue (roadmap Phase 81): who may queue factory work, on which
 * repos, and the objective an advisor action becomes. DB-free parts of src/lib/agents/factory-queue.ts.
 */
import { afterEach, describe, expect, it } from 'vitest'
import { advisorObjective, buildAcceptanceCriteria, factoryAccess, factoryAllowlist } from '@/lib/agents/factory-queue'
import factoryConfig from '../../factory/factory.config.json'
import type { AdvisorAction } from '@/lib/ai/advisor'

const original = process.env.FACTORY_USER_ID
afterEach(() => {
  if (original === undefined) delete process.env.FACTORY_USER_ID
  else process.env.FACTORY_USER_ID = original
})

describe('factoryAccess', () => {
  it('is off until FACTORY_USER_ID names the owner', () => {
    delete process.env.FACTORY_USER_ID
    expect(factoryAccess('u1')).toEqual({ ok: false, reason: expect.stringMatching(/FACTORY_USER_ID/) })
  })

  it('serves the owner only', () => {
    process.env.FACTORY_USER_ID = 'owner'
    expect(factoryAccess('owner')).toEqual({ ok: true })
    expect(factoryAccess('someone-else')).toEqual({ ok: false, reason: expect.stringMatching(/owner only/) })
  })

  it('only for repos on the factory allowlist (case-insensitive)', () => {
    process.env.FACTORY_USER_ID = 'owner'
    const listed = factoryConfig.repos[0]
    expect(factoryAccess('owner', listed.toUpperCase())).toEqual({ ok: true })
    expect(factoryAccess('owner', 'smithdavedesign/not-a-factory-repo')).toEqual({ ok: false, reason: expect.stringMatching(/allowlist/) })
  })

  it('reads the allowlist from factory/factory.config.json (same repo, no copy)', () => {
    expect(factoryAllowlist()).toEqual(factoryConfig.repos)
  })
})

describe('advisor action → factory objective', () => {
  const action: AdvisorAction = {
    repoId: 1, repoName: 'r', action: 'Add a CI workflow', reasoning: 'No CI means regressions ship', impactType: 'health',
    effort: 'quick', estimatedImpact: '+6 health',
  } as AdvisorAction

  it('carries the action, its context and the acceptance criteria as "Done when"', () => {
    const o = advisorObjective(action)
    expect(o.split('\n')[0]).toBe('Add a CI workflow')
    expect(o).toContain('Context: No CI means regressions ship')
    expect(o).toContain('Expected impact: +6 health')
    expect(o).toMatch(/Done when:\n- Add a CI workflow — No CI means regressions ship/)
    expect(o).toContain('- Health score does not decrease')
    expect(buildAcceptanceCriteria(action).at(-1)).toBe('All existing tests continue to pass')
  })
})
