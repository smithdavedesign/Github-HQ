'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, GitPullRequest, Search, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { queueGstackSkill } from '@/lib/actions/nexus'
import { getSuggestedActions, FINDINGS_PREVIEW_COUNT } from '@/lib/skills/suggest-actions'
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

  // Suggest an action based on the skill that ran and the findings content
  const suggestedActions = getSuggestedActions(skillName, findings, repoName)

  async function handleQueueAction(skill: 'ship' | 'investigate', objective: string) {
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
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          aria-expanded={showAll}
        >
          {showAll ? (
            <><ChevronUp className="w-3 h-3" />Show less</>
          ) : (
            <><ChevronDown className="w-3 h-3" />Show {hidden} more finding{hidden !== 1 ? 's' : ''}</>
          )}
        </button>
      )}

      {/* Actionable items — suggested next steps */}
      {nexusEnabled && suggestedActions.length > 0 && (
        <div className="pt-1.5 border-t border-border/30 space-y-1.5">
          <p className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wide">
            Suggested actions
          </p>
          <div className="flex flex-col gap-1">
            {suggestedActions.map((action, ai) => (
              <div key={ai} className="flex items-start gap-2 p-2 rounded-md bg-muted/10 border border-border/30">
                <div className="shrink-0 mt-0.5">
                  {action.skill === 'ship' ? (
                    <GitPullRequest className="w-3 h-3 text-indigo-500" />
                  ) : action.skill === 'investigate' ? (
                    <Search className="w-3 h-3 text-red-500" />
                  ) : (
                    <Wrench className="w-3 h-3 text-amber-500" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-medium leading-snug">{action.label}</p>
                  <p className="text-[9px] text-muted-foreground mt-0.5">{action.objective}</p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[9px] shrink-0"
                  disabled={queuingFor !== null}
                  onClick={() => handleQueueAction(action.skill, action.objective)}
                >
                  {queuingFor === action.skill ? '…' : `Run /${action.skill}`}
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

