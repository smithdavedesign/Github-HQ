/**
 * When each gstack skill last ran on a repo, for the skill launcher. Runs report back two ways: an
 * agent_skill_report event, or a factory request that finished (verified, reported, PR). Counting
 * only the events left /health at "119 days ago" after the factory had run it that morning. Pure.
 */
import { isGstackSkill, type GstackSkill } from './skill-policy'

export interface SkillRunRecord {
  daysAgo: number
  findingCount: number
  taskId: string
  summary?: string
  topFindings: string[]
}

/** The skill an objective names ("Run /health skill", "/investigate the 500s"), if it's a gstack skill. */
export function skillFromObjective(objective: string): GstackSkill | null {
  const m = /(?:^|[\s(])\/([a-z][a-z-]*)\b/.exec(objective)
  return m && isGstackSkill(m[1]) ? m[1] : null
}

export interface SkillReportEvent { occurredAt: Date; metadata: unknown }
export interface FinishedRequest { id: string; skill: string | null; objective: string; findings: string | null; resolvedAt: Date | null; updatedAt: Date }

const bullets = (md: string | null) => (md ?? '').split('\n').map(l => /^\s*[-*]\s+(.+)/.exec(l)?.[1]?.trim()).filter((l): l is string => !!l)

export function skillRuns(events: SkillReportEvent[], requests: FinishedRequest[], now = new Date()): Record<string, SkillRunRecord & { at: number }> {
  const out: Record<string, SkillRunRecord & { at: number }> = {}
  const daysAgo = (t: number) => Math.floor((now.getTime() - t) / 86_400_000)
  const keep = (skill: string, r: SkillRunRecord & { at: number }) => { if (!out[skill] || r.at > out[skill].at) out[skill] = r }
  for (const e of events) {
    const meta = e.metadata as { skillName?: string; findings?: string[]; taskId?: string; summary?: string } | null
    if (!meta?.skillName) continue
    const findings = Array.isArray(meta.findings) ? meta.findings.filter(f => f && f.trim()) : []
    const at = e.occurredAt.getTime()
    keep(meta.skillName, { at, daysAgo: daysAgo(at), findingCount: findings.length, taskId: meta.taskId ?? '', summary: meta.summary, topFindings: findings.slice(0, 3) })
  }
  for (const r of requests) {
    const skill = (r.skill && isGstackSkill(r.skill) && r.skill !== 'ship' ? r.skill : null) ?? skillFromObjective(r.objective) ?? (r.skill && isGstackSkill(r.skill) ? r.skill : null)
    if (!skill) continue
    const found = bullets(r.findings)
    const at = (r.resolvedAt ?? r.updatedAt).getTime()
    keep(skill, { at, daysAgo: daysAgo(at), findingCount: found.length, taskId: r.id, summary: 'run by the factory', topFindings: found.slice(0, 3) })
  }
  return out
}
