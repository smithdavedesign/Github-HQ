const BLOCKER_PATTERN = /\b(blocked|blocking|cannot|can't|failed|failure|error|timeout|timed out|missing|denied|permission)\b/i

function compactLine(line: string): string {
  return line.replace(/\s+/g, ' ').trim()
}

function clip(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return `${text.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`
}

export function extractUnresolvedBlockers(
  findings: string[],
  summary?: string | null,
  maxItems = 3,
): string[] {
  const blockers: string[] = []

  for (const finding of findings) {
    const line = compactLine(finding)
    if (!line || !BLOCKER_PATTERN.test(line)) continue
    blockers.push(clip(line, 180))
    if (blockers.length >= maxItems) return blockers
  }

  if (summary && blockers.length < maxItems) {
    const fragments = summary
      .split(/\n|(?<=[.!?])\s+/)
      .map((part) => compactLine(part))
      .filter(Boolean)

    for (const fragment of fragments) {
      if (!BLOCKER_PATTERN.test(fragment)) continue
      blockers.push(clip(fragment, 180))
      if (blockers.length >= maxItems) break
    }
  }

  return blockers
}

interface BuildSkillChainObjectiveInput {
  parentSkill: string
  inheritedFindings: string[]
  unresolvedBlockers: string[]
}

export function buildSkillChainObjective(input: BuildSkillChainObjectiveInput): string {
  const findings = input.inheritedFindings.slice(0, 3).map((finding) => clip(compactLine(finding), 180))
  const blockers = input.unresolvedBlockers.slice(0, 3).map((blocker) => clip(compactLine(blocker), 180))

  const lines = [
    `Continue from /${input.parentSkill} with explicit objective continuity.`,
    `Carry forward unresolved findings: ${findings.length > 0 ? findings.join('; ') : 'none provided'}`,
  ]

  if (blockers.length > 0) {
    lines.push(`Prioritize unresolved blockers: ${blockers.join('; ')}`)
  }

  return lines.join('\n\n')
}
