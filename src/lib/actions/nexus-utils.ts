/**
 * Pure gstack skill constants — no auth/DB imports, safe for unit tests.
 */

export type GstackSkill =
  | 'investigate' | 'review'
  | 'qa-only' | 'qa'
  | 'ship' | 'document-release'
  | 'health' | 'canary'
  | 'retro'

export const SKILL_META: Record<GstackSkill, { label: string; phase: string; type: 'report' | 'fix' | 'pr' }> = {
  investigate:        { label: '/investigate',       phase: 'Understand',    type: 'fix'    },
  review:             { label: '/review',            phase: 'Understand',    type: 'report' },
  'qa-only':          { label: '/qa-only',           phase: 'Build Quality', type: 'report' },
  qa:                 { label: '/qa',                phase: 'Build Quality', type: 'fix'    },
  ship:               { label: '/ship',              phase: 'Ship',          type: 'pr'     },
  'document-release': { label: '/document-release',  phase: 'Ship',          type: 'fix'    },
  health:             { label: '/health',            phase: 'Monitor',       type: 'report' },
  canary:             { label: '/canary',            phase: 'Monitor',       type: 'report' },
  retro:              { label: '/retro',             phase: 'Reflect',       type: 'report' },
}
