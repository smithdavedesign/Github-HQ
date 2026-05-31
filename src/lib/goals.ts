// Shared goal constants — not a server file, safe to import anywhere

export type GoalType = 'mrr' | 'health_avg' | 'repos_live' | 'revenue_repos' | 'custom'

export const GOAL_PRESETS: Record<GoalType, {
  label: string
  unit: string
  placeholder: string
  description: string
}> = {
  mrr:           { label: 'Monthly Revenue',      unit: '$',      placeholder: '5000', description: 'Total MRR across all repos' },
  health_avg:    { label: 'Avg Portfolio Health', unit: 'score',  placeholder: '80',   description: 'Average health score across all repos' },
  repos_live:    { label: 'Repos in Production',  unit: 'repos',  placeholder: '10',   description: 'Repos with a healthy deployment URL' },
  revenue_repos: { label: 'Revenue-Generating',   unit: 'repos',  placeholder: '5',    description: 'Repos marked as revenue-generating' },
  custom:        { label: 'Custom Goal',           unit: '',       placeholder: '100',  description: 'Track anything manually' },
}
