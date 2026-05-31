import { describe, it, expect } from 'vitest'
import type { NLQueryFilters } from '@/app/api/nl-query/route'

// Mirror of applyNLFilters from repo-table.tsx for isolated unit testing
type MinRepo = {
  visibility: string
  stars: number | null
  mrr: string | number | null
  isRevenueGenerating: boolean | null
  language: string | null
  metrics: { healthScore: number | null; activityScore: number | null; securityScore: number | null; activityStatus: string | null; lastPush: Date | null } | null
  techStack: { language: string | null; frontend: string | null; database: string | null } | null
  securityFindings: { severity: string }[]
}

function applyNLFilters(rows: MinRepo[], filters: NLQueryFilters): MinRepo[] {
  const now = Date.now()
  let result = rows.filter(row => {
    const m = row.metrics
    const stack = row.techStack

    if (filters.healthMin != null && (m?.healthScore ?? 0) < filters.healthMin) return false
    if (filters.healthMax != null && (m?.healthScore ?? 0) > filters.healthMax) return false
    if (filters.activityStatus?.length && !filters.activityStatus.includes(m?.activityStatus ?? '')) return false

    if (filters.lastPushBeforeDays != null) {
      const cutoff = now - filters.lastPushBeforeDays * 86400_000
      const push = m?.lastPush ? m.lastPush.getTime() : 0
      if (push > cutoff) return false
    }
    if (filters.lastPushAfterDays != null) {
      const cutoff = now - filters.lastPushAfterDays * 86400_000
      const push = m?.lastPush ? m.lastPush.getTime() : 0
      if (push < cutoff) return false
    }

    if (filters.visibility && row.visibility !== filters.visibility) return false
    if (filters.language) {
      const lang = (stack?.language ?? row.language ?? '').toLowerCase()
      if (!lang.includes(filters.language.toLowerCase())) return false
    }
    if (filters.framework) {
      const fw = (stack?.frontend ?? '').toLowerCase()
      if (!fw.includes(filters.framework.toLowerCase())) return false
    }
    if (filters.isRevenueGenerating != null && row.isRevenueGenerating !== filters.isRevenueGenerating) return false
    if (filters.hasSecurityIssues === true) {
      const serious = row.securityFindings.filter(f => f.severity === 'critical' || f.severity === 'high')
      if (serious.length === 0) return false
    }
    if (filters.starsMin != null && (row.stars ?? 0) < filters.starsMin) return false
    if (filters.mrrMin != null && parseFloat(String(row.mrr ?? '0')) < filters.mrrMin) return false

    return true
  })

  if (filters.sortBy) {
    const dir = filters.sortDir === 'desc' ? 1 : -1
    result = result.sort((a, b) => {
      switch (filters.sortBy) {
        case 'health': return ((b.metrics?.healthScore ?? 0) - (a.metrics?.healthScore ?? 0)) * dir
        case 'stars': return ((b.stars ?? 0) - (a.stars ?? 0)) * dir
        default: return 0
      }
    })
  }

  return result
}

const makeRepo = (overrides: Partial<MinRepo> = {}): MinRepo => ({
  visibility: 'public',
  stars: 10,
  mrr: '0',
  isRevenueGenerating: false,
  language: 'TypeScript',
  metrics: {
    healthScore: 75,
    activityScore: 60,
    securityScore: 100,
    activityStatus: 'Actively Maintained',
    lastPush: new Date(Date.now() - 7 * 86400_000),  // 7 days ago
  },
  techStack: { language: 'TypeScript', frontend: 'Next.js', database: 'PostgreSQL' },
  securityFindings: [],
  ...overrides,
})

describe('applyNLFilters', () => {
  it('returns all rows when no filters', () => {
    const repos = [makeRepo(), makeRepo({ visibility: 'private' })]
    expect(applyNLFilters(repos, {})).toHaveLength(2)
  })

  describe('health filters', () => {
    it('filters by healthMin', () => {
      const repos = [makeRepo({ metrics: { ...makeRepo().metrics!, healthScore: 50 } }), makeRepo()]
      expect(applyNLFilters(repos, { healthMin: 70 })).toHaveLength(1)
    })

    it('filters by healthMax', () => {
      const repos = [makeRepo({ metrics: { ...makeRepo().metrics!, healthScore: 95 } }), makeRepo()]
      expect(applyNLFilters(repos, { healthMax: 80 })).toHaveLength(1)
    })

    it('filters by health range', () => {
      const repos = [
        makeRepo({ metrics: { ...makeRepo().metrics!, healthScore: 40 } }),
        makeRepo(),  // 75
        makeRepo({ metrics: { ...makeRepo().metrics!, healthScore: 95 } }),
      ]
      const result = applyNLFilters(repos, { healthMin: 60, healthMax: 85 })
      expect(result).toHaveLength(1)
      expect(result[0].metrics?.healthScore).toBe(75)
    })
  })

  describe('activity filters', () => {
    it('filters by activityStatus', () => {
      const repos = [
        makeRepo({ metrics: { ...makeRepo().metrics!, activityStatus: 'Dormant' } }),
        makeRepo(),  // Actively Maintained
      ]
      expect(applyNLFilters(repos, { activityStatus: ['Dormant', 'Abandoned'] })).toHaveLength(1)
    })
  })

  describe('time filters', () => {
    it('filters repos not pushed in N days (lastPushBeforeDays)', () => {
      const recent = makeRepo({ metrics: { ...makeRepo().metrics!, lastPush: new Date(Date.now() - 10 * 86400_000) } })
      const old = makeRepo({ metrics: { ...makeRepo().metrics!, lastPush: new Date(Date.now() - 200 * 86400_000) } })
      expect(applyNLFilters([recent, old], { lastPushBeforeDays: 180 })).toHaveLength(1)
    })

    it('filters repos pushed within N days (lastPushAfterDays)', () => {
      const recent = makeRepo({ metrics: { ...makeRepo().metrics!, lastPush: new Date(Date.now() - 5 * 86400_000) } })
      const old = makeRepo({ metrics: { ...makeRepo().metrics!, lastPush: new Date(Date.now() - 90 * 86400_000) } })
      expect(applyNLFilters([recent, old], { lastPushAfterDays: 30 })).toHaveLength(1)
    })
  })

  describe('property filters', () => {
    it('filters by visibility', () => {
      const repos = [makeRepo(), makeRepo({ visibility: 'private' })]
      expect(applyNLFilters(repos, { visibility: 'private' })).toHaveLength(1)
    })

    it('filters by language (case-insensitive)', () => {
      const repos = [makeRepo(), makeRepo({ language: 'Python', techStack: { ...makeRepo().techStack!, language: 'Python' } })]
      expect(applyNLFilters(repos, { language: 'python' })).toHaveLength(1)
    })

    it('filters by framework', () => {
      const repos = [
        makeRepo(),  // Next.js
        makeRepo({ techStack: { ...makeRepo().techStack!, frontend: 'Vue' } }),
      ]
      expect(applyNLFilters(repos, { framework: 'Next' })).toHaveLength(1)
    })

    it('filters revenue-generating repos', () => {
      const repos = [makeRepo(), makeRepo({ isRevenueGenerating: true, mrr: '100' })]
      expect(applyNLFilters(repos, { isRevenueGenerating: true })).toHaveLength(1)
    })

    it('filters repos with security issues', () => {
      const clean = makeRepo()
      const vulnerable = makeRepo({ securityFindings: [{ severity: 'critical' }] })
      expect(applyNLFilters([clean, vulnerable], { hasSecurityIssues: true })).toHaveLength(1)
    })

    it('medium-severity findings do NOT trigger hasSecurityIssues', () => {
      const mediumOnly = makeRepo({ securityFindings: [{ severity: 'medium' }] })
      expect(applyNLFilters([mediumOnly], { hasSecurityIssues: true })).toHaveLength(0)
    })

    it('filters by starsMin', () => {
      const repos = [makeRepo({ stars: 5 }), makeRepo({ stars: 100 })]
      expect(applyNLFilters(repos, { starsMin: 50 })).toHaveLength(1)
    })

    it('filters by mrrMin', () => {
      const repos = [makeRepo({ mrr: '50' }), makeRepo({ mrr: '500' })]
      expect(applyNLFilters(repos, { mrrMin: 200 })).toHaveLength(1)
    })
  })

  describe('sorting', () => {
    it('sorts by health descending by default', () => {
      const repos = [
        makeRepo({ metrics: { ...makeRepo().metrics!, healthScore: 60 } }),
        makeRepo({ metrics: { ...makeRepo().metrics!, healthScore: 90 } }),
      ]
      const result = applyNLFilters(repos, { sortBy: 'health', sortDir: 'desc' })
      expect(result[0].metrics?.healthScore).toBe(90)
    })

    it('sorts by health ascending', () => {
      const repos = [
        makeRepo({ metrics: { ...makeRepo().metrics!, healthScore: 90 } }),
        makeRepo({ metrics: { ...makeRepo().metrics!, healthScore: 60 } }),
      ]
      const result = applyNLFilters(repos, { sortBy: 'health', sortDir: 'asc' })
      expect(result[0].metrics?.healthScore).toBe(60)
    })

    it('sorts by stars descending', () => {
      const repos = [makeRepo({ stars: 10 }), makeRepo({ stars: 500 })]
      const result = applyNLFilters(repos, { sortBy: 'stars', sortDir: 'desc' })
      expect(result[0].stars).toBe(500)
    })
  })

  describe('combined filters', () => {
    it('chains multiple filter conditions correctly', () => {
      const repos = [
        makeRepo({ visibility: 'private', metrics: { ...makeRepo().metrics!, healthScore: 40, activityStatus: 'Dormant' } }),
        makeRepo({ visibility: 'private', metrics: { ...makeRepo().metrics!, healthScore: 80, activityStatus: 'Actively Maintained' } }),
        makeRepo({ visibility: 'public', metrics: { ...makeRepo().metrics!, healthScore: 40, activityStatus: 'Dormant' } }),
      ]
      const result = applyNLFilters(repos, {
        visibility: 'private',
        activityStatus: ['Dormant'],
      })
      expect(result).toHaveLength(1)
      expect(result[0].metrics?.healthScore).toBe(40)
    })
  })
})
