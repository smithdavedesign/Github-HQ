'use client'

import { useState, useEffect, useRef } from 'react'
import { Search, Heart, GitPullRequest, FileText, ChevronDown, ChevronUp, ChevronRight, Eye, Tv, RotateCcw, BookOpen } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { queueGstackSkill, SKILL_META } from '@/lib/actions/nexus'
import { toast } from 'sonner'
import type { GstackSkill } from '@/lib/actions/nexus'

// ─── Skill definitions ────────────────────────────────────────────────────────

interface SkillDef {
  id: GstackSkill
  icon: typeof Search
  iconColor: string
  label: string
  description: string
  typeLabel: string
  typeBadgeColor: string
}

const SKILLS_BY_PHASE: { phase: string; skills: SkillDef[] }[] = [
  {
    phase: 'Understand',
    skills: [
      { id: 'investigate', icon: Search, iconColor: 'text-red-500', label: '/investigate', description: 'Diagnoses root cause then fixes if safe. Best for bugs, security alerts, or failing builds.', typeLabel: 'Analyze + Fix', typeBadgeColor: 'bg-red-50 text-red-600 border-red-200' },
      { id: 'review', icon: Eye, iconColor: 'text-slate-500', label: '/review', description: 'Pre-merge code review. Surfaces security issues, logic errors, and structural problems — no changes.', typeLabel: 'Report only', typeBadgeColor: 'bg-slate-50 text-slate-600 border-slate-200' },
    ],
  },
  {
    phase: 'Build Quality',
    skills: [
      { id: 'qa-only', icon: FileText, iconColor: 'text-amber-500', label: '/qa-only', description: 'Finds bugs and documents them with repro steps. No fixes — pure report so you decide what to act on.', typeLabel: 'Report only', typeBadgeColor: 'bg-amber-50 text-amber-600 border-amber-200' },
      { id: 'qa', icon: Search, iconColor: 'text-orange-500', label: '/qa', description: 'Finds bugs and iteratively fixes them with atomic commits. Re-verifies after each fix.', typeLabel: 'Analyze + Fix', typeBadgeColor: 'bg-orange-50 text-orange-600 border-orange-200' },
    ],
  },
  {
    phase: 'Ship',
    skills: [
      { id: 'ship', icon: GitPullRequest, iconColor: 'text-indigo-500', label: '/ship', description: 'Full release pipeline — implement objective, run tests, open PR. Use when you have a clear task.', typeLabel: 'Creates PR', typeBadgeColor: 'bg-indigo-50 text-indigo-600 border-indigo-200' },
      { id: 'document-release', icon: BookOpen, iconColor: 'text-blue-500', label: '/document-release', description: 'Updates README, docs, and CHANGELOG to match what was shipped. Run after merging a PR.', typeLabel: 'Commits', typeBadgeColor: 'bg-blue-50 text-blue-600 border-blue-200' },
    ],
  },
  {
    phase: 'Monitor',
    skills: [
      { id: 'health', icon: Heart, iconColor: 'text-emerald-500', label: '/health', description: 'Scores TypeScript, tests, lint, and dead code. Produces a report with findings — no changes.', typeLabel: 'Report only', typeBadgeColor: 'bg-emerald-50 text-emerald-600 border-emerald-200' },
      { id: 'canary', icon: Tv, iconColor: 'text-violet-500', label: '/canary', description: 'Checks the live app for console errors and performance regressions. Requires a deployment URL.', typeLabel: 'Report only', typeBadgeColor: 'bg-violet-50 text-violet-600 border-violet-200' },
    ],
  },
  {
    phase: 'Reflect',
    skills: [
      { id: 'retro', icon: RotateCcw, iconColor: 'text-cyan-500', label: '/retro', description: 'Analyses this week\'s commits — patterns, wins, growth areas. Run on Mondays for a weekly snapshot.', typeLabel: 'Report only', typeBadgeColor: 'bg-cyan-50 text-cyan-600 border-cyan-200' },
    ],
  },
]

const STORAGE_KEY = 'gstack-open-phases'

// ─── Types ────────────────────────────────────────────────────────────────────

type SkillStatus = 'idle' | 'queued' | 'running' | 'report_ready' | 'pr_ready' | 'failed'

interface GstackSkillLauncherProps {
  repoId: number
  repoName: string
  repoHomepage?: string | null
  defaultObjectives: Record<GstackSkill, string>
  nexusEnabled: boolean
}

// ─── Component ────────────────────────────────────────────────────────────────

export function GstackSkillLauncher({ repoId, repoName, repoHomepage, defaultObjectives, nexusEnabled }: GstackSkillLauncherProps) {
  const [openPhases, setOpenPhases] = useState<Set<string>>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      return stored ? new Set(JSON.parse(stored) as string[]) : new Set(['Understand', 'Monitor'])
    } catch { return new Set(['Understand', 'Monitor']) }
  })
  const [expandedSkill, setExpandedSkill] = useState<GstackSkill | null>(null)
  const [objectives, setObjectives] = useState(defaultObjectives)
  const [loading, setLoading] = useState<GstackSkill | null>(null)
  const [skillStatus, setSkillStatus] = useState<Record<string, SkillStatus>>({})
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Persist open phases to localStorage
  function togglePhase(phase: string) {
    setOpenPhases(prev => {
      const next = new Set(prev)
      next.has(phase) ? next.delete(phase) : next.add(phase)
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify([...next])) } catch {}
      return next
    })
  }

  // Poll lifecycle for in-flight skills
  useEffect(() => {
    let cancelled = false
    async function checkLifecycle() {
      try {
        const res = await fetch(`/api/agent-task-status?repoId=${repoId}`)
        if (!res.ok || cancelled) return
        const data = await res.json() as { status: string }
        if (cancelled) return
        const terminalStatuses = ['report_ready', 'pr_ready', 'failed', 'merged']
        if (terminalStatuses.includes(data.status)) {
          const resolved: SkillStatus = data.status === 'merged' ? 'pr_ready' : data.status as SkillStatus
          setSkillStatus(prev => {
            const inFlight = Object.entries(prev).find(([, s]) => s === 'queued' || s === 'running')
            if (inFlight) return { ...prev, [inFlight[0]]: resolved }
            return prev
          })
          if (pollRef.current) clearInterval(pollRef.current)
        }
      } catch { /* non-fatal */ }
    }
    const hasInFlight = Object.values(skillStatus).some(s => s === 'queued' || s === 'running')
    if (hasInFlight) {
      pollRef.current = setInterval(checkLifecycle, 5000)
      checkLifecycle()
    }
    return () => { cancelled = true; if (pollRef.current) clearInterval(pollRef.current) }
  }, [repoId, JSON.stringify(skillStatus)])  // eslint-disable-line react-hooks/exhaustive-deps

  async function handleRun(skill: GstackSkill) {
    const objective = objectives[skill].trim()
    if (!objective) { toast.error('Enter an objective first'); return }
    setLoading(skill)
    try {
      await queueGstackSkill(repoId, skill, objective)
      setSkillStatus(prev => ({ ...prev, [skill]: 'queued' }))
      setExpandedSkill(null)
      const meta = SKILL_META[skill]
      toast.success(`gstack ${meta.label} queued`, {
        description: meta.type === 'pr' ? 'Agent will open a PR when done.' : 'Report will appear in Agent History when ready.',
        duration: 4000,
      })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to queue skill')
    } finally {
      setLoading(null)
    }
  }

  if (!nexusEnabled) {
    return (
      <div className="rounded-lg border border-border/40 bg-muted/10 px-4 py-5 text-center space-y-1.5">
        <p className="text-sm font-medium text-muted-foreground">gstack skills not available</p>
        <p className="text-xs text-muted-foreground">
          Add <code className="text-[10px] bg-muted px-1 py-0.5 rounded">NEXUS_API_URL</code> and{' '}
          <code className="text-[10px] bg-muted px-1 py-0.5 rounded">NEXUS_API_TOKEN</code> to your environment.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-1">
      {SKILLS_BY_PHASE.map(({ phase, skills }) => {
        const isOpen = openPhases.has(phase)

        return (
          <div key={phase}>
            {/* Phase header — toggle */}
            <button
              onClick={() => togglePhase(phase)}
              className="flex items-center gap-2 w-full py-1.5 group"
              aria-expanded={isOpen}
              aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${phase} skills`}
            >
              <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/50 group-hover:text-muted-foreground/70 transition-colors">
                {phase}
              </span>
              <div className="flex-1 h-px bg-border/20" />
              {isOpen
                ? <ChevronUp className="w-3 h-3 text-muted-foreground/30 group-hover:text-muted-foreground/50 shrink-0" />
                : <ChevronRight className="w-3 h-3 text-muted-foreground/30 group-hover:text-muted-foreground/50 shrink-0" />}
            </button>

            {/* Skills in this phase */}
            {isOpen && (
              <div className="space-y-1 mb-2">
                {skills.map(skill => {
                  const Icon = skill.icon
                  const isExpanded = expandedSkill === skill.id
                  const isLoading = loading === skill.id
                  const status = skillStatus[skill.id] ?? 'idle'

                  // Hide canary if no deployment configured
                  if (skill.id === 'canary' && !repoHomepage) {
                    return (
                      <div key={skill.id} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-border/30 bg-muted/5 opacity-60">
                        <Icon className={`w-3.5 h-3.5 shrink-0 ${skill.iconColor}`} />
                        <span className="text-xs font-mono text-muted-foreground">{skill.label}</span>
                        <span className="text-[10px] text-muted-foreground ml-auto">Needs deployment URL</span>
                      </div>
                    )
                  }

                  return (
                    <div key={skill.id} className={`rounded-lg border transition-colors ${isExpanded ? 'border-border bg-muted/20' : 'border-border/40 bg-muted/5 hover:bg-muted/15'}`}>
                      {/* Row — click to expand */}
                      <button
                        onClick={() => setExpandedSkill(isExpanded ? null : skill.id)}
                        className="flex items-center gap-3 px-3 py-2 w-full text-left"
                        disabled={isLoading}
                        aria-expanded={isExpanded}
                        aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${skill.label}`}
                      >
                        <Icon className={`w-3.5 h-3.5 shrink-0 ${skill.iconColor}`} />
                        <span className="text-xs font-mono font-medium">{skill.label}</span>
                        <Badge variant="outline" className={`text-[9px] h-4 px-1.5 ml-1 ${skill.typeBadgeColor}`}>
                          {skill.typeLabel}
                        </Badge>
                        {/* Live status badges */}
                        {status === 'queued' && <Badge variant="outline" className="text-[9px] h-4 px-1.5 ml-auto bg-indigo-50 text-indigo-600 border-indigo-200">Queued…</Badge>}
                        {status === 'running' && <Badge variant="outline" className="text-[9px] h-4 px-1.5 ml-auto bg-amber-50 text-amber-600 border-amber-200">Running…</Badge>}
                        {status === 'report_ready' && <Badge variant="outline" className="text-[9px] h-4 px-1.5 ml-auto bg-violet-50 text-violet-600 border-violet-200">Report ready ↓</Badge>}
                        {status === 'pr_ready' && <Badge variant="outline" className="text-[9px] h-4 px-1.5 ml-auto bg-emerald-50 text-emerald-600 border-emerald-200">PR Ready ✓</Badge>}
                        {status === 'failed' && <Badge variant="outline" className="text-[9px] h-4 px-1.5 ml-auto bg-red-50 text-red-600 border-red-200">Failed</Badge>}
                        {status === 'idle' && <ChevronDown className={`w-3 h-3 text-muted-foreground/40 ml-auto shrink-0 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />}
                      </button>

                      {/* Expanded objective + description */}
                      {isExpanded && (
                        <div className="px-3 pb-3 pt-1 space-y-2 border-t border-border/30">
                          <p className="text-[10px] text-muted-foreground leading-relaxed">{skill.description}</p>
                          <div className="space-y-1">
                            <label className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">Objective</label>
                            <textarea
                              value={objectives[skill.id]}
                              onChange={e => setObjectives(prev => ({ ...prev, [skill.id]: e.target.value }))}
                              rows={2}
                              className="w-full text-xs rounded-md border border-input bg-background px-2.5 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                          </div>
                          <Button size="sm" className="h-7 text-xs w-full gap-1.5" onClick={() => handleRun(skill.id)} disabled={isLoading || !objectives[skill.id].trim()}>
                            {isLoading ? <><span className="animate-pulse">·</span> Queuing…</> : <>Run {skill.label}</>}
                          </Button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
