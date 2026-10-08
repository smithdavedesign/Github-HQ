/**
 * Pure helpers for `agent_requests` (roadmap Phase 81, docs/agent-hq-migration-prd.md §5–§8),
 * shared by RepoHQ (enqueue, status, lifecycle, Agents page), the MCP server and the factory
 * worker. No DB client, no `server-only`: mcp/server.ts and factory/ run under plain tsx.
 */
import type { agentRequests, portfolioEvents } from '../db/schema'
import type { GstackSkill } from '../skills/skill-policy'
import type { AgentLifecycleStage } from './lifecycle-utils'

export type RequestMode = 'fix' | 'report'
export type RequestSource = 'ui-advisor' | 'ui-skill' | 'auto-dispatch' | 'mcp' | 'openclaw'
export type RequestStatus = 'queued' | 'running' | 'pr' | 'verified' | 'reported' | 'rejected' | 'failed' | 'cancelled'

/** Still waiting on the factory: block another request on the same repo, show in the queue. */
export const OPEN_REQUEST_STATUSES: readonly RequestStatus[] = ['queued', 'running']

export function isOpenRequestStatus(status: string): boolean {
  return (OPEN_REQUEST_STATUSES as readonly string[]).includes(status)
}

/**
 * gstack skills → what the factory does with them (PRD §8). `fix` = a judged draft PR through the
 * owner-requested path; `report` = a read-only, sandboxed investigation whose findings come back.
 * `canary` has no factory equivalent: it needs a browser and live egress the sandbox doesn't have.
 */
export const SKILL_MODES: Record<GstackSkill, RequestMode | null> = {
  ship: 'fix',
  qa: 'fix',
  'document-release': 'fix',
  review: 'report',
  'qa-only': 'report',
  health: 'report',
  investigate: 'report',
  retro: 'report',
  canary: null,
}

export function modeForSkill(skill: GstackSkill): RequestMode | null {
  return SKILL_MODES[skill]
}

export const REQUEST_STATUS_LABELS: Record<RequestStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  pr: 'Draft PR opened',
  verified: 'Verified — held (owner-requested is at stage report)',
  reported: 'Report ready',
  rejected: 'Rejected by the judge',
  failed: 'Failed',
  cancelled: 'Cancelled',
}

export function requestStatusLabel(status: string): string {
  return REQUEST_STATUS_LABELS[status as RequestStatus] ?? status
}

/**
 * The repo Agent tab's lifecycle stage for a factory request (PRD §7). A `pr` request's later
 * stages (merged / rejected / ci_failing / needs_human) come from PR events, not from the row.
 */
export function stageForRequest(status: string): AgentLifecycleStage {
  switch (status) {
    case 'queued': return 'queued'
    case 'running': return 'running'
    case 'pr': return 'pr_ready'
    case 'verified': return 'verified'
    case 'reported': return 'report_ready'
    case 'rejected':
    case 'failed': return 'failed'
    default: return 'idle'
  }
}

type RequestInsert = typeof agentRequests.$inferInsert
type EventInsert = typeof portfolioEvents.$inferInsert

export interface NewRequest {
  id: string
  userId: string
  repoId: number | null
  repo: string
  mode: RequestMode
  skill?: GstackSkill | null
  objective: string
  source: RequestSource
  now: Date
}

/** Longest objective accepted; prompts stay readable and a pasted log can't flood the row. */
export const MAX_OBJECTIVE_CHARS = 4_000

export function newRequestRow(r: NewRequest): RequestInsert {
  return {
    id: r.id, userId: r.userId, repoId: r.repoId, repo: r.repo, mode: r.mode, skill: r.skill ?? null,
    objective: r.objective.trim().slice(0, MAX_OBJECTIVE_CHARS), source: r.source, status: 'queued',
    createdAt: r.now, updatedAt: r.now,
  }
}

/**
 * The `agent_task_queued` event for a request — what lifecycle, the feed, the accuracy loop and
 * PR-merge detection key on (metadata.taskId = request id). `extra` carries advisor context
 * (impactType, predictedDelta, effort, riskTier) the accuracy loop reads back.
 */
export function queuedEventValues(r: NewRequest, title: string, extra: Record<string, unknown> = {}): EventInsert {
  return {
    userId: r.userId,
    repoId: r.repoId,
    eventType: 'agent_task_queued',
    title,
    description: r.objective.slice(0, 2_000),
    metadata: {
      taskId: r.id,
      executor: 'factory',
      mode: r.mode,
      source: r.source,
      ...(r.skill ? { skillName: r.skill } : {}),
      ...extra,
    },
  }
}

/** Case-insensitive allowlist check against factory/factory.config.json `repos`. */
export function isAllowlisted(repoFullName: string, allowlist: readonly string[]): boolean {
  const name = repoFullName.toLowerCase()
  return allowlist.some(r => r.toLowerCase() === name)
}

export interface WeeklyRepoCandidate {
  id: number
  name: string
  fullName: string
  isFocused: boolean | null
  isArchived: boolean | null
  lastPush: Date | null
}

/**
 * Repos for the weekly /retro and /health runs (digest cron). Only ones the factory takes work
 * for: any other repo is refused at enqueue, so picking it would quietly run nothing. Focused
 * repos come first, then the most recently pushed.
 */
export function pickWeeklySkillRepos<R extends WeeklyRepoCandidate>(repos: R[], allowlist: readonly string[], limit: number): R[] {
  return repos
    .filter(r => !r.isArchived && isAllowlisted(r.fullName, allowlist))
    .sort((a, b) => Number(!!b.isFocused) - Number(!!a.isFocused)
      || (b.lastPush?.getTime() ?? 0) - (a.lastPush?.getTime() ?? 0)
      || a.name.localeCompare(b.name))
    .slice(0, limit)
}

/**
 * Bullet findings from a factory report (the "## Findings" section; PRD §8), as the
 * string list the skill-report UI and the MCP findings tools read. Capped like the old webhook.
 */
export function findingsFromReport(report: string | null | undefined, max = 20): string[] {
  if (!report) return []
  const lines = report.split('\n')
  const start = lines.findIndex(l => /^#+\s*Findings\b/i.test(l))
  if (start < 0) return []
  const out: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (/^#+\s/.test(line)) break
    const m = /^\s*(?:[-*•]|\d+[.)])\s+(.+)$/.exec(line)
    if (m) out.push(m[1].trim().slice(0, 300))
    if (out.length >= max) break
  }
  return out
}
