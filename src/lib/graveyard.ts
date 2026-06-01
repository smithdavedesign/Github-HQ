export const ABANDONMENT_REASONS = [
  'No demand',
  'Too competitive',
  'Too much maintenance',
  'Lost interest',
  'Merged into another project',
  'Pivoted direction',
  'Ran out of time',
  'Technical debt too high',
] as const

export type AbandonmentReason = typeof ABANDONMENT_REASONS[number]
