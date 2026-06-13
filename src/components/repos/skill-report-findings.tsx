'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, GitPullRequest, Search, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { queueGstackSkill } from '@/lib/actions/nexus'
import type { GstackSkill } from '@/lib/actions/nexus-utils'
import { getSuggestedActions, getDefaultActions, FINDINGS_PREVIEW_COUNT } from '@/lib/skills/suggest-actions'
import { toast } from 'sonner'

interface SkillReportFindingsProps {
  findings: string[]
  skillName?: string
  repoId: number
  repoName: string
  nexusEnabled: boolean
}

/**
 * Renders the full findings list from a skill report (no truncation) with:
 * - "Show all / Show less" toggle
 * - Actionable queue buttons based on finding type
 * - Suggested next skill based on what the report found
 */
export function SkillReportFindings({ findings, skillName, repoId, repoName, nexusEnabled }: SkillReportFindingsProps) {
  const [showAll, setShowAll] = useState(false)
  const [queuingFor, setQueuingFor] = useState<string | null>(null)

  const PREVIEW = FINDINGS_PREVIEW_COUNT
  const visible = showAll ? findings : findings.slice(0, PREVIEW)
  const hidden = findings.length - PREVIEW

  // Infer specific actions from findings keywords
  const inferredActions = getSuggestedActions(skillName, findings, repoName)
  // Always show default actions for report-only skills so there's always a way to act
  const defaultActions = inferredActions.length === 0
    ? getDefaultActions(skillName, findings, repoName)
    : []
  const suggestedActions = inferredActions.length > 0 ? inferredActions : defaultActions

  async function handleQueueAction(skill: GstackSkill, objective: string) {
    setQueuingFor(skill)
    try {
      await queueGstackSkill(repoId, skill, objective)
      toast.success(`/${skill} queued`, { description: 'Track progress in Agent History.', duration: 4000 })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to queue')
    } finally {
      setQueuingFor(null)
    }
  }

  return (
    <div className="mt-2 space-y-2">
      {/* Findings list */}
      <ul className="space-y-1">
        {visible.map((f, fi) => (
          <li key={fi} className="text-[10px] text-muted-foreground flex items-start gap-1.5 leading-relaxed">
            <span className="shrink-0 mt-0.5 text-muted-foreground/40">·</span>
            <span>{f}</span>
          </li>
        ))}
      </ul>

      {/* Show all / show less toggle */}
      {findings.length > PREVIEW && (
        <button
          onClick={() => setShowAll(v => !v)}
          className="flex items-center gap-1 text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-200 underline underline-offset-2 transition-colors mt-1"
          aria-expanded={showAll}
        >
          {showAll ? (
            <><ChevronUp className="w-3 h-3" />Show less</>
          ) : (
            <><ChevronDown className="w-3 h-3" />Show {hidden} more finding{hidden !== 1 ? 's' : ''}</>
          )}
        </button>
      )}

      {/* Actionable items — always shown for report-only skills with findings */}
      {suggestedActions.length > 0 && (
        <div className="pt-2 border-t border-border/40 space-y-2">
          <p className="text-[10px] font-semibold text-foreground/70 uppercase tracking-wide">
            Take action
          </p>
          <div className="flex flex-col gap-1.5">
            {suggestedActions.map((action, ai) => (
              <div key={ai} className="flex items-center gap-2 p-2 rounded-md bg-muted/20 border border-border/40">
                <div className="shrink-0">
                  {action.skill === 'ship' ? (
                    <GitPullRequest className="w-3.5 h-3.5 text-indigo-500" />
                  ) : action.skill === 'investigate' ? (
                    <Search className="w-3.5 h-3.5 text-red-500" />
                  ) : (
                    <Wrench className="w-3.5 h-3.5 text-amber-500" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-medium leading-snug">{action.label}</p>
                  <p className="text-[9px] text-muted-foreground mt-0.5 line-clamp-2">{action.objective}</p>
                </div>
                <Button
                  size="sm"
                  variant={action.skill === 'investigate' ? 'destructive' : 'default'}
                  className="h-7 px-3 text-[11px] shrink-0"
                  disabled={queuingFor !== null || !nexusEnabled}
                  title={!nexusEnabled ? 'Configure NEXUS_API_URL and NEXUS_API_TOKEN to queue agent tasks' : undefined}
                  onClick={() => nexusEnabled && handleQueueAction(action.skill, action.objective)}
                >
                  {queuingFor === action.skill ? '…' : `Run /${action.skill}`}
                </Button>
              </div>
            ))}
          </div>
          {!nexusEnabled && (
            <p className="text-[9px] text-muted-foreground">Configure Nexus to queue agent tasks from here.</p>
          )}
        </div>
      )}
    </div>
  )
}

