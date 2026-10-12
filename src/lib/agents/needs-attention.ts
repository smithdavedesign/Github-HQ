/**
 * The Agents page's "Needs attention" strip: the few things on the page that want a decision or a
 * fix, pulled to the top so they aren't buried under the history. Pure, so it's unit-tested.
 */
import type { AccuracyStat } from '@/lib/actions/advisor-accuracy-utils'
import type { ClaudeUsage, CopilotUsage } from './usage-utils'
import { errorSummary } from '@/lib/utils'

export interface AttentionItem {
  tone: 'fail' | 'warn' | 'info'
  text: string
  /** The full message when `text` is a summary (shown on hover). */
  detail?: string
  /** In-page anchor or URL for the detail. */
  href?: string
}

export interface AttentionInput {
  failing: { system: string; component: string; event: string; message: string }[] | null
  pipeline: { tickAt: Date | null; ok: boolean | null; errors: string[] } | null
  claude: ClaudeUsage | null
  copilot: CopilotUsage | null
  accuracy: AccuracyStat[]
  now: Date
}

const HOUR = 3_600_000
const MAX_FAILING = 5

export function needsAttention({ failing, pipeline, claude, copilot, accuracy, now }: AttentionInput): AttentionItem[] {
  const items: AttentionItem[] = []
  for (const f of (failing ?? []).slice(0, MAX_FAILING)) {
    const summary = errorSummary(f.message)
    items.push({ tone: 'fail', text: `${f.system}/${f.component}: ${summary}`, detail: summary !== f.message ? f.message : undefined, href: '?tab=log#system-log' })
  }
  if (failing && failing.length > MAX_FAILING) items.push({ tone: 'fail', text: `…and ${failing.length - MAX_FAILING} more failing checks`, href: '?tab=log#system-log' })

  if (pipeline) {
    if (pipeline.ok === false || pipeline.errors.length) {
      items.push({ tone: 'fail', text: `Idea pipeline: ${pipeline.errors[0] ? errorSummary(pipeline.errors[0]) : 'last tick failed'}${pipeline.errors.length > 1 ? ` (+${pipeline.errors.length - 1} more)` : ''}`, detail: pipeline.errors.join('\n') || undefined, href: '?tab=now#idea-pipeline' })
    }
    // It ticks every 15 minutes; an hour of silence means launchd or the Mac stopped it.
    if (!pipeline.tickAt || now.getTime() - pipeline.tickAt.getTime() > HOUR) {
      items.push({ tone: 'warn', text: pipeline.tickAt ? `Idea pipeline hasn't ticked for ${Math.round((now.getTime() - pipeline.tickAt.getTime()) / HOUR)}h (it runs every 15 min)` : 'Idea pipeline has never reported a tick', href: '?tab=now#idea-pipeline' })
    }
  }

  if (claude?.lastCapacity && now.getTime() - claude.lastCapacity.at.getTime() < 24 * HOUR) {
    items.push({ tone: 'warn', text: `Claude subscription hit its limit: ${claude.lastCapacity.message}` })
  }

  if (copilot?.installed && copilot.percentRemaining === 0 && !copilot.overagePermitted) {
    items.push({ tone: 'warn', text: `Copilot premium requests used up${copilot.resetDate ? ` until ${copilot.resetDate}` : ''}: the Copilot builder is paused and reviews fall back to the local reviewer` })
  }

  const measured = accuracy.some(s => s.dataPoints > 0)
  const failedRuns = accuracy.reduce((n, s) => n + s.executionFailures, 0)
  if (!measured && failedRuns > 0) {
    items.push({ tone: 'info', text: `Advisor accuracy: no merged PR has a measured health change yet (${failedRuns} failed runs aren't counted against the advice)`, href: '?tab=kpis#advisor-accuracy' })
  }
  return items
}
