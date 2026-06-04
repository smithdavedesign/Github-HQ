'use client'

import { useState, useEffect, useRef } from 'react'
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
    tagline: 'Debug & fix',
    description: 'Diagnoses the root cause first, then fixes only if it\'s safe and low-risk. Best for failing builds, security alerts, and mysterious bugs. Will report findings and skip the fix if the change is too risky.',
    badge: 'Analyze + Fix',
    badgeColor: 'bg-red-50 text-red-600 border-red-200 dark:bg-red-950/30 dark:text-red-400',
  },
  {
    id: 'health',
    icon: Heart,
    iconColor: 'text-amber-500',
    label: '/health',
    tagline: 'Code quality report',
    description: 'Runs TypeScript, tests, lint, and dead code checks — produces a scored report with findings. Makes no code changes. Use this to understand the current state of the codebase before taking action.',
    badge: 'Report only',
    badgeColor: 'bg-amber-50 text-amber-600 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400',
  },
  {
    id: 'ship',
    icon: GitPullRequest,
    iconColor: 'text-indigo-500',
    label: '/ship',
    tagline: 'Implement & open PR',
    description: 'Implements the objective, runs tests, and opens a PR — full pipeline from start to finish. Use when you have a clear task and want the agent to execute it completely.',
    badge: 'Creates PR',
    badgeColor: 'bg-indigo-50 text-indigo-600 border-indigo-200 dark:bg-indigo-950/30 dark:text-indigo-400',
  },
]

interface GstackSkillLauncherProps {
  repoId: number
  repoName: string
  defaultObjectives: Record<GstackSkill, string>
  nexusEnabled: boolean
}

type SkillStatus = 'idle' | 'queued' | 'running' | 'report_ready' | 'pr_ready' | 'failed'

export function GstackSkillLauncher({ repoId, repoName, defaultObjectives, nexusEnabled }: GstackSkillLauncherProps) {
  const [expanded, setExpanded] = useState<GstackSkill | null>(null)
  const [objectives, setObjectives] = useState(defaultObjectives)
  const [loading, setLoading] = useState<GstackSkill | null>(null)
  const [skillStatus, setSkillStatus] = useState<Record<string, SkillStatus>>({})
  const [launched, setLaunched] = useState<Record<string, boolean>>({})
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // On mount + after launch: poll lifecycle to show report_ready / pr_ready / failed
  useEffect(() => {
    let cancelled = false
    async function checkLifecycle() {
      try {
        const res = await fetch(`/api/agent-task-status?repoId=${repoId}`)
        if (!res.ok || cancelled) return
        const data = await res.json() as { status: string; taskId?: string }
        if (cancelled) return
        // Map lifecycle stage to a skill-agnostic status
        const rawStatus = data.status
        const terminalStatuses = ['report_ready', 'pr_ready', 'failed', 'merged']
        if (terminalStatuses.includes(rawStatus)) {
          const resolvedStatus: SkillStatus = rawStatus === 'merged' ? 'pr_ready'
            : rawStatus as SkillStatus
          setSkillStatus(prev => {
            const inFlight = Object.entries(prev).find(([, s]) => s === 'queued' || s === 'running')
            if (inFlight) return { ...prev, [inFlight[0]]: resolvedStatus }
            return prev
          })
          if (pollRef.current) clearInterval(pollRef.current)
        }
      } catch { /* non-fatal */ }
    }
    // Poll every 5s while any skill is in-flight
    const hasInFlight = Object.values(skillStatus).some(s => s === 'queued' || s === 'running')
    if (hasInFlight) {
      pollRef.current = setInterval(checkLifecycle, 5000)
      checkLifecycle()
    }
    return () => { cancelled = true; if (pollRef.current) clearInterval(pollRef.current) }
  }, [repoId, JSON.stringify(skillStatus)])  // eslint-disable-line react-hooks/exhaustive-deps

  if (!nexusEnabled) {
    return (
      <div className="rounded-lg border border-border/40 bg-muted/10 px-4 py-5 text-center space-y-2">
        <p className="text-sm font-medium text-muted-foreground">gstack skills not available</p>
        <p className="text-xs text-muted-foreground max-w-sm mx-auto">
          Add <code className="text-[10px] bg-muted px-1 py-0.5 rounded">NEXUS_API_URL</code> and{' '}
          <code className="text-[10px] bg-muted px-1 py-0.5 rounded">NEXUS_API_TOKEN</code> to your
          environment to enable /investigate, /health, and /ship on this repo.
        </p>
      </div>
    )
  }

  async function handleRun(skill: GstackSkill) {
    const objective = objectives[skill].trim()
    if (!objective) { toast.error('Enter an objective first'); return }
    setLoading(skill)
    try {
      await queueGstackSkill(repoId, skill, objective)
      setLaunched(prev => ({ ...prev, [skill]: true }))
      setSkillStatus(prev => ({ ...prev, [skill]: 'queued' }))
      setExpanded(null)
      toast.success(`gstack /${skill} queued for ${repoName}`, {
        description: skill === 'ship' ? 'Agent will open a PR when done.' : 'Report will appear in Agent History when ready.',
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {SKILLS.map(skill => {
          const Icon = skill.icon
          const isExpanded = expanded === skill.id
          const isLoading = loading === skill.id
          const wasLaunched = launched[skill.id]
          const liveStatus = skillStatus[skill.id] ?? 'idle'

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
                aria-expanded={isExpanded}
                aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${skill.label} skill details`}
              >
                <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${skill.iconColor}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium font-mono">{skill.label}</span>
                    <Badge variant="outline" className={`text-[10px] h-4 px-1.5 ${skill.badgeColor}`}>
                      {skill.badge}
                    </Badge>
                    {wasLaunched && liveStatus === 'queued' && (
                      <Badge variant="outline" className="text-[10px] h-4 px-1.5 bg-indigo-50 text-indigo-600 border-indigo-200">
                        Queued…
                      </Badge>
                    )}
                    {liveStatus === 'running' && (
                      <Badge variant="outline" className="text-[10px] h-4 px-1.5 bg-amber-50 text-amber-600 border-amber-200">
                        Running…
                      </Badge>
                    )}
                    {liveStatus === 'report_ready' && (
                      <Badge variant="outline" className="text-[10px] h-4 px-1.5 bg-violet-50 text-violet-600 border-violet-200">
                        Report ready ↓
                      </Badge>
                    )}
                    {liveStatus === 'pr_ready' && (
                      <Badge variant="outline" className="text-[10px] h-4 px-1.5 bg-emerald-50 text-emerald-600 border-emerald-200">
                        PR Ready ✓
                      </Badge>
                    )}
                    {liveStatus === 'failed' && (
                      <Badge variant="outline" className="text-[10px] h-4 px-1.5 bg-red-50 text-red-600 border-red-200">
                        Failed
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{skill.tagline}</p>
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
