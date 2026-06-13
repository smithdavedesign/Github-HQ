export const LIFECYCLE_STAGES = [
  'idea',
  'building',
  'beta',
  'production',
  'growing',
  'maintaining',
  'sunsetting',
  'archived',
] as const

export type LifecycleStage = typeof LIFECYCLE_STAGES[number]

export const LIFECYCLE_META: Record<LifecycleStage, {
  label: string
  description: string
  color: string  // Tailwind text color class
  bg: string     // Tailwind bg/border class for badge
}> = {
  idea:        { label: 'Idea',        description: 'Concept not yet started',             color: 'text-slate-600',   bg: 'bg-slate-500/10 border-slate-400/30' },
  building:    { label: 'Building',    description: 'Actively in development',             color: 'text-blue-600',    bg: 'bg-blue-500/10 border-blue-400/30' },
  beta:        { label: 'Beta',        description: 'Live but not production-ready',       color: 'text-cyan-600',    bg: 'bg-cyan-500/10 border-cyan-400/30' },
  production:  { label: 'Production',  description: 'Stable and in production',            color: 'text-emerald-600', bg: 'bg-emerald-500/10 border-emerald-400/30' },
  growing:     { label: 'Growing',     description: 'Active growth phase',                 color: 'text-green-600',   bg: 'bg-green-500/10 border-green-400/30' },
  maintaining: { label: 'Maintaining', description: 'Stable, receiving routine updates',   color: 'text-amber-600',   bg: 'bg-amber-500/10 border-amber-400/30' },
  sunsetting:  { label: 'Sunsetting',  description: 'Being wound down',                    color: 'text-orange-600',  bg: 'bg-orange-500/10 border-orange-400/30' },
  archived:    { label: 'Archived',    description: 'No longer maintained',                color: 'text-muted-foreground', bg: 'bg-muted border-border' },
}

