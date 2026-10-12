import { describe, it, expect } from 'vitest'
import { errorSummary } from '@/lib/utils'

describe('errorSummary', () => {
  it('drops git hints and collapses lines', () => {
    const git = 'build tiebreak MVP: sandbox patch: git add failed: The following paths are ignored by one of your .gitignore files:\nnode_modules\nhint: Use -f if you really want to add them.\nhint: Turn this message off by running\nhint: "git config advice.addIgnoredFile false"'
    expect(errorSummary(git)).toBe('build tiebreak MVP: sandbox patch: git add failed: The following paths are ignored by one of your .gitignore files: node_modules')
  })
  it('prefers a log\'s last Error: line over its preamble', () => {
    const log = 'Worker job failed: agent command failed with code 1: [gstack-ship] Starting /ship for execution 6537\n[gstack-ship] Worktree: /opt/render/x\n[gstack-ship] Error: claude native binary not installed.'
    expect(errorSummary(log)).toBe('Error: claude native binary not installed.')
  })
  it('cuts long text with an ellipsis and handles nothing', () => {
    expect(errorSummary('x'.repeat(300), 20)).toBe(`${'x'.repeat(19)}…`)
    expect(errorSummary(null)).toBe('')
  })
})
