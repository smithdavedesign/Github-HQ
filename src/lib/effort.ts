export type EffortLevel = 'low' | 'medium' | 'high'

export const EFFORT_META: Record<EffortLevel, { label: string; description: string; color: string }> = {
  low:    { label: 'Low',    description: '< 4 hours to meaningful progress', color: 'text-emerald-600' },
  medium: { label: 'Medium', description: '1-3 days of focused work',          color: 'text-amber-600'   },
  high:   { label: 'High',   description: 'Week+ of sustained effort',         color: 'text-red-600'     },
}

export function getQuadrant(opportunityScore: number, effort: EffortLevel): {
  name: string
  color: string
  description: string
} {
  const highOpp = opportunityScore >= 50
  const lowEffort = effort === 'low'

  if (highOpp && lowEffort)  return { name: 'Quick Win',     color: 'text-emerald-600', description: 'High value, low cost — do these first' }
  if (highOpp && !lowEffort) return { name: 'Invest',        color: 'text-blue-600',    description: 'High value, high cost — worth the commitment' }
  if (!highOpp && lowEffort) return { name: 'Fill-In',       color: 'text-slate-500',   description: 'Easy but low impact — do when blocked' }
  return                            { name: 'Deprioritize',  color: 'text-red-400',     description: 'High cost, low return — avoid for now' }
}
