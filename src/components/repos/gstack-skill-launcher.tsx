'use client'

import { useState } from 'react'
import { Search, Heart, GitPullRequest, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { queueGstackSkill } from '@/lib/actions/nexus'
import { toast } from 'sonner'
import type { GstackSkill } from '@/lib/actions/nexus'

interface SkillDef {
  id: GstackSkill
  icon: typeof Search
  iconColor: string
  label: string
  tagline: string
  description: string
  badge: string
  badgeColor: string
}

const SKILLS: SkillDef[] = [
  {
    id: 'investigate',
    icon: Search,
    iconColor: 'text-red-500',
    label: '/investigate',
    tagline: 'Debug & security',
    description: '4-phase root cause analysis — diagnose first, fix only if safe and low blast-radius. Best for failing builds, security alerts, and mysterious bugs.',
    badge: 'Tier 3',
    badgeColor: 'bg-red-50 text-red-600 border-red-200 dark:bg-red-950/30 dark:text-red-400',
  },
  {
    id: 'health',
    icon: Heart,
    iconColor: 'text-amber-500',
    label: '/health',
    tagline: 'Code quality check',
    description: 'Runs TypeScript, tests, lint, and dead code analysis. Produces a scored dashboard with findings and recommendations. No code changes — report only.',
    badge: 'Read-only',
    badgeColor: 'bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400',
  },
  {
    id: 'ship',
    icon: GitPullRequest,
    iconColor: 'text-indigo-500',
    label: '/ship',
    tagline: 'Create PR',
    description: 'Full ship pipeline — pre-flight checks, run tests, implement changes, open PR. Use when you have a clear objective and want the agent to execute and ship.',
    badge: 'Tier 2',
    badgeColor: 'bg-indigo-50 text-indigo-600 border-indigo-200 dark:bg-indigo-950/30 dark:text-indigo-400',
  },
]

interface GstackSkillLauncherProps {
  repoId: number
  repoName: string
  defaultObjectives: Record<GstackSkill, string>
  nexusEnabled: boolean
}

export function GstackSkillLauncher({ repoId, repoName, defaultObjectives, nexusEnabled }: GstackSkillLauncherProps) {
  const [expanded, setExpanded] = useState<GstackSkill | null>(null)
  const [objectives, setObjectives] = useState(defaultObjectives)
  const [loading, setLoading] = useState<GstackSkill | null>(null)
  const [launched, setLaunched] = useState<Record<string, boolean>>({})

  if (!nexusEnabled) return null

  async function handleRun(skill: GstackSkill) {
    const objective = objectives[skill].trim()
    if (!objective) { toast.error('Enter an objective first'); return }
    setLoading(skill)
    try {
      await queueGstackSkill(repoId, skill, objective)
      setLaunched(prev => ({ ...prev, [skill]: true }))
      setExpanded(null)
      toast.success(`gstack /${skill} queued for ${repoName}`, {
        description: 'Track progress in the Agent History section below.',
        duration: 5000,
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to queue skill')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 mb-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          gstack skills
        </p>
        <span className="text-[10px] text-muted-foreground/60">— trigger an AI agent directly on this repo</span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        {SKILLS.map(skill => {
          const Icon = skill.icon
          const isExpanded = expanded === skill.id
          const isLoading = loading === skill.id
          const wasLaunched = launched[skill.id]

          return (
            <div
              key={skill.id}
              className={`rounded-lg border transition-colors ${
                isExpanded
                  ? 'border-border bg-muted/20'
                  : 'border-border/50 bg-muted/10 hover:bg-muted/20'
              }`}
            >
              {/* Card header — always visible */}
              <button
                onClick={() => setExpanded(isExpanded ? null : skill.id)}
                className="flex items-start gap-3 p-3 w-full text-left"
                disabled={isLoading}
              >
                <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${skill.iconColor}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium font-mono">{skill.label}</span>
                    <Badge variant="outline" className={`text-[10px] h-4 px-1.5 ${skill.badgeColor}`}>
                      {skill.badge}
                    </Badge>
                    {wasLaunched && (
                      <Badge variant="outline" className="text-[10px] h-4 px-1.5 bg-emerald-50 text-emerald-600 border-emerald-200">
                        Queued ✓
                      </Badge>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{skill.tagline}</p>
                </div>
                {isExpanded
                  ? <ChevronUp className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                  : <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />}
              </button>

              {/* Expanded detail + objective */}
              {isExpanded && (
                <div className="px-3 pb-3 space-y-2.5 border-t border-border/40 pt-2.5 ml-7">
                  <p className="text-[11px] text-muted-foreground leading-relaxed">{skill.description}</p>
                  <div className="space-y-1">
                    <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
                      Objective
                    </label>
                    <textarea
                      value={objectives[skill.id]}
                      onChange={e => setObjectives(prev => ({ ...prev, [skill.id]: e.target.value }))}
                      rows={2}
                      className="w-full text-xs rounded-md border border-input bg-background px-2.5 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                      placeholder={`What should the agent ${skill.id === 'ship' ? 'implement' : 'investigate'}?`}
                    />
                  </div>
                  <Button
                    size="sm"
                    className="h-7 text-xs gap-1.5 w-full"
                    onClick={() => handleRun(skill.id)}
                    disabled={isLoading || !objectives[skill.id].trim()}
                  >
                    {isLoading ? (
                      <>
                        <span className="animate-pulse">·</span> Queuing…
                      </>
                    ) : (
                      <>Run {skill.label}</>
                    )}
                  </Button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
