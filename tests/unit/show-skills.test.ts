/**
 * The show-production skills (2026-11-27): gstack-style roles for a repo that runs a show. Offered on show repos only,
 * and the factory's prompt points the agent at the repo's own .claude/skills/<name>/SKILL.md.
 */
import { describe, expect, it } from 'vitest'
import { SHOW_SKILLS, SKILL_META, isGstackSkill, isShowRepo, isShowSkill, showSkillObjectives } from '../../src/lib/skills/skill-policy'
import { modeForSkill } from '../../src/lib/agents/factory-request-utils'
import { ownerReportTask, ownerRequestedTask, reportPrompt } from '../../factory/lib/tasks'

describe('the show skills', () => {
  it('are gstack skills in the Show phase: the producer and editor report, the writer and assets open a PR', () => {
    for (const s of SHOW_SKILLS) {
      expect(isGstackSkill(s)).toBe(true)
      expect(isShowSkill(s)).toBe(true)
      expect(SKILL_META[s].phase).toBe('Show')
    }
    expect(modeForSkill('show-producer')).toBe('report')
    expect(modeForSkill('show-editor')).toBe('report')
    expect(modeForSkill('show-casting')).toBe('report')
    expect(modeForSkill('show-writer')).toBe('fix')
    expect(modeForSkill('show-assets')).toBe('fix')
    expect(isShowSkill('ship')).toBe(false)
  })

  it('run only on a show repo: Botchelor, or one tagged show', () => {
    expect(isShowRepo('smithdavedesign/botchelor', [])).toBe(true)
    expect(isShowRepo('SmithDaveDesign/Botchelor', null)).toBe(true)
    expect(isShowRepo('someone/other', ['Show'])).toBe(true)
    expect(isShowRepo('someone/other', ['showcase'])).toBe(false)
    expect(isShowRepo('someone/other', undefined)).toBe(false)
  })

  it('have a default objective naming the repo', () => {
    const o = showSkillObjectives('botchelor')
    expect(Object.keys(o).sort()).toEqual([...SHOW_SKILLS].sort())
    for (const v of Object.values(o)) expect(v).toContain('botchelor')
  })

  it("point the factory's agent at the repo's own skill file", () => {
    const fix = ownerRequestedTask('smithdavedesign/botchelor', 'Write the exit lines', 't1', 'show-writer')
    expect(fix.objective).toContain('.claude/skills/show-writer/SKILL.md')
    expect(fix.objective).toContain('.claude/skills/showrunner/SKILL.md')
    expect(fix.objective).toContain('If the file is missing, change nothing')
    const report = reportPrompt(ownerReportTask('smithdavedesign/botchelor', "What's next?", 't2', 'show-producer'), 'smithdavedesign/botchelor')
    expect(report).toContain('.claude/skills/show-producer/SKILL.md')
    expect(report).toContain('executive producer')
  })
})
