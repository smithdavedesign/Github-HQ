import { describe, expect, it, vi } from 'vitest'
import {
  buildLocalReviewPrompt, checklistText, diffFiles, localReviewComment, parseLocalReview, runLocalReview,
} from '../../factory/lib/local-review'

const PATCH = [
  'diff --git a/src/lib/utils/retry.ts b/src/lib/utils/retry.ts',
  '--- a/src/lib/utils/retry.ts',
  '+++ b/src/lib/utils/retry.ts',
  '@@ -1,3 +1,4 @@',
  '+export const query = (id: string) => sql(`select * from t where id = ${id}`)',
  'diff --git a/src/lib/utils/__tests__/retry.test.ts b/src/lib/utils/__tests__/retry.test.ts',
  '+it("retries", () => {})',
].join('\n')

const reply = (issues: unknown[]) => JSON.stringify({ issues })

describe('local review (gstack /review on the local stack when Copilot is out)', () => {
  it('uses gstack\'s review categories, without its fix-first instructions', () => {
    const gstack = '# Pre-Landing Review Checklist\n## Instructions\nAUTO-FIXED things…\n## Review Categories\n### Pass 1 — CRITICAL\n#### SQL & Data Safety'
    expect(checklistText(gstack)).toBe('## Review Categories\n### Pass 1 — CRITICAL\n#### SQL & Data Safety')
    expect(checklistText(null)).toMatch(/^Pass 1 \(CRITICAL\): SQL & data safety/)
  })

  it('asks for JSON about the diff, with the task and the checklist', () => {
    const p = buildLocalReviewPrompt({ objective: 'Add retry tests' }, PATCH, 'CHECKS')
    expect(p).toContain('Task it was given: Add retry tests')
    expect(p).toContain('=== CHECKLIST ===\nCHECKS')
    expect(p).toContain('diff --git a/src/lib/utils/retry.ts')
    expect(p).toMatch(/Reply with ONE JSON object/)
  })

  it('lists the files a diff touches', () => {
    expect([...diffFiles(PATCH)]).toEqual(['src/lib/utils/retry.ts', 'src/lib/utils/__tests__/retry.test.ts'])
  })

  it('keeps findings about files in the diff, critical first; drops invented paths', () => {
    const parsed = parseLocalReview(`Here you go:\n${reply([
      { severity: 'informational', file: 'src/lib/utils/__tests__/retry.test.ts', line: 1, problem: 'Test asserts nothing', fix: 'Assert the call count' },
      { severity: 'critical', file: 'b/src/lib/utils/retry.ts', line: 1, problem: 'SQL built by string interpolation', fix: 'Use a parameter' },
      { severity: 'critical', file: 'src/db/secret.ts', line: 9, problem: 'Made up', fix: 'x' },
    ])}`, PATCH)
    expect(parsed).toEqual({
      dropped: 1,
      issues: [
        { severity: 'critical', file: 'src/lib/utils/retry.ts', line: 1, problem: 'SQL built by string interpolation', fix: 'Use a parameter' },
        { severity: 'informational', file: 'src/lib/utils/__tests__/retry.test.ts', line: 1, problem: 'Test asserts nothing', fix: 'Assert the call count' },
      ],
    })
  })

  it('a reply that isn\'t the JSON asked for is no review; an empty list is a clean one', () => {
    expect(parseLocalReview('Looks good to me!', PATCH)).toBeNull()
    expect(parseLocalReview('{"verdict":"ok"}', PATCH)).toBeNull()
    expect(parseLocalReview(reply([]), PATCH)).toEqual({ issues: [], dropped: 0 })
  })

  it('posts in gstack\'s pre-landing format and says why Copilot didn\'t review', () => {
    const body = localReviewComment({
      model: 'local-qwen3', durationMs: 1, dropped: 1,
      issues: [{ severity: 'critical', file: 'src/lib/utils/retry.ts', line: 1, problem: 'SQL built by `string` interpolation', fix: 'Use a parameter' }],
    }, 'Copilot code review is unavailable (premium requests used up this month)', true)
    expect(body).toContain('## Local review (gstack /review checklist · `local-qwen3`)')
    expect(body).toContain('Pre-Landing Review: 1 issue (1 critical, 0 informational)')
    expect(body).toContain("- **critical** `src/lib/utils/retry.ts:1`: SQL built by 'string' interpolation\n  Recommended fix: Use a parameter")
    expect(body).toContain('Copilot code review is unavailable (premium requests used up this month), so the factory\'s local AI stack reviewed this PR instead.')
    expect(body).toContain('1 finding(s) about files outside the diff were dropped.')
    expect(localReviewComment({ model: 'm', durationMs: 1, dropped: 0, issues: [] }, 'x', false)).toContain('Pre-Landing Review: No issues found.')
  })

  const cfg = {
    litellm: { url: 'http://litellm.test', key: 'k' },
    judge: { adversarial: { enabled: true, timeoutMs: 5_000, reviewers: { M1: 'local-qwen3' } } },
  } as never

  it('asks the reviewer model for the builder\'s tier (a different family) through LiteLLM', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: reply([]) } }] }))) as unknown as typeof fetch
    const r = await runLocalReview(cfg, 'M1', { objective: 'x' }, PATCH, { fetchImpl })
    expect(r).toMatchObject({ model: 'local-qwen3', issues: [], dropped: 0 })
    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(url).toBe('http://litellm.test/v1/chat/completions')
    // Thinking off for the local Qwen3, or it reasons away the whole budget and returns nothing.
    expect(JSON.parse(init.body)).toMatchObject({ model: 'local-qwen3', reasoning_effort: 'none' })
  })

  it('no reviewer for the tier, or the call fails: no review', async () => {
    expect(await runLocalReview(cfg, 'M0', { objective: 'x' }, PATCH, { fetchImpl: vi.fn() as never })).toBeNull()
    const down = vi.fn(async () => { throw new Error('ECONNREFUSED') }) as unknown as typeof fetch
    expect(await runLocalReview(cfg, 'M1', { objective: 'x' }, PATCH, { fetchImpl: down })).toBeNull()
  })
})
