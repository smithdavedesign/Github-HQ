import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import type { ModelTier } from '../../src/lib/agents/model-router'
import { reviewerModel } from './adversary'
import type { FactoryConfig } from './config'
import { run } from './proc'
import type { FactoryTask } from './tasks'

/**
 * The Reviewer role when GitHub Copilot code review isn't available (premium requests used up,
 * review turned off, or the daily limit reached): gstack's pre-landing /review checklist, run by
 * the local AI stack on the PR's diff and posted as a PR comment. Advisory, like Copilot's: it
 * can't approve or block.
 *
 * The model comes from the adversarial pass's reviewer map, so it's a different model family from
 * the one that wrote the change (a free-cloud build gets the local Qwen3). One chat call, no
 * sandbox: it reads the diff, it never runs repo code.
 */

/** gstack's checklist on this Mac; the built-in one below is used when gstack isn't installed. */
export const GSTACK_CHECKLIST = path.join(homedir(), '.claude', 'skills', 'gstack', 'review', 'checklist.md')
const MAX_CHECKLIST_CHARS = 6_000
export const MAX_REVIEW_DIFF_CHARS = 16_000
const MAX_ISSUES = 10

const BUILT_IN_CHECKLIST = [
  'Pass 1 (CRITICAL): SQL & data safety (interpolated SQL, check-then-set races, N+1 queries); race conditions and',
  'non-atomic status transitions; LLM output trusted without validation (URLs fetched, values written to the DB);',
  'shell injection (shell=True or interpolated commands, eval on generated code); unsafe HTML rendering of user data;',
  'missing cases in switches over enums.',
  'Pass 2 (INFORMATIONAL): error handling that swallows failures; dead or unreachable code; magic numbers; tests that',
  'don\'t test the change; conditional side effects; anything deleted that the task didn\'t ask for.',
].join('\n')

/** The checklist's review categories, without the Fix-First instructions: this reviewer can't edit. */
export function checklistText(raw: string | null): string {
  if (!raw) return BUILT_IN_CHECKLIST
  const start = raw.indexOf('## Review Categories')
  const body = (start >= 0 ? raw.slice(start) : raw).trim()
  return body.length > MAX_CHECKLIST_CHARS ? `${body.slice(0, MAX_CHECKLIST_CHARS)}\n…` : body
}

export function loadGstackChecklist(file = GSTACK_CHECKLIST): string | null {
  try {
    return existsSync(file) ? readFileSync(file, 'utf8') : null
  } catch {
    return null
  }
}

export function buildLocalReviewPrompt(task: Pick<FactoryTask, 'objective'>, patch: string, checklist: string): string {
  const diff = patch.length > MAX_REVIEW_DIFF_CHARS ? `${patch.slice(0, MAX_REVIEW_DIFF_CHARS)}\n… (diff truncated)` : patch
  return [
    'You are doing a pre-landing code review of a pull request, using the checklist below.',
    'Another AI model wrote it, and it already passes the repository\'s typecheck, lint and tests.',
    `Task it was given: ${task.objective}`,
    '',
    'Only flag real problems you can point to in the diff. Be specific and terse. Skip anything that is fine.',
    '',
    '=== CHECKLIST ===',
    checklist,
    '',
    '=== DIFF ===',
    diff,
    '',
    'Reply with ONE JSON object and nothing else:',
    '{"issues":[{"severity":"critical"|"informational","file":"<path from the diff>","line":<number or null>,"problem":"<one line>","fix":"<one line>"}]}',
    'Use {"issues":[]} when there is nothing real to flag.',
  ].join('\n')
}

export interface LocalReviewIssue { severity: 'critical' | 'informational'; file: string; line: number | null; problem: string; fix: string }
export interface LocalReview { model: string; issues: LocalReviewIssue[]; dropped: number; durationMs: number }

/** Files the diff touches (`diff --git a/x b/x`). */
export function diffFiles(patch: string): Set<string> {
  return new Set([...patch.matchAll(/^diff --git a\/\S+ b\/(\S+)$/gm)].map(m => m[1]))
}

/**
 * The reply's issues, keeping only those about a file in the diff (a small model invents paths).
 * Null when the reply isn't the JSON asked for.
 */
export function parseLocalReview(reply: string, patch: string): { issues: LocalReviewIssue[]; dropped: number } | null {
  const json = /\{[\s\S]*\}/.exec(reply)?.[0]
  if (!json) return null
  let parsed: unknown
  try { parsed = JSON.parse(json) } catch { return null }
  const raw = (parsed as { issues?: unknown }).issues
  if (!Array.isArray(raw)) return null
  const files = diffFiles(patch)
  const issues: LocalReviewIssue[] = []
  let dropped = 0
  for (const item of raw) {
    const i = item as Partial<Record<keyof LocalReviewIssue, unknown>>
    const file = typeof i.file === 'string' ? i.file.replace(/^[ab]\//, '').trim() : ''
    const problem = typeof i.problem === 'string' ? i.problem.trim() : ''
    if (!file || !problem || !files.has(file)) { dropped++; continue }
    issues.push({
      severity: i.severity === 'critical' ? 'critical' : 'informational',
      file,
      line: typeof i.line === 'number' && Number.isInteger(i.line) && i.line > 0 ? i.line : null,
      problem: problem.slice(0, 300),
      fix: typeof i.fix === 'string' ? i.fix.trim().slice(0, 300) : '',
    })
  }
  issues.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'critical' ? -1 : 1))
  return { issues: issues.slice(0, MAX_ISSUES), dropped: dropped + Math.max(0, issues.length - MAX_ISSUES) }
}

/** The PR comment, in gstack's pre-landing format, with why Copilot didn't review it. */
export function localReviewComment(r: LocalReview, whyNotCopilot: string, gstack: boolean): string {
  const critical = r.issues.filter(i => i.severity === 'critical').length
  const head = r.issues.length === 0
    ? 'Pre-Landing Review: No issues found.'
    : `Pre-Landing Review: ${r.issues.length} issue${r.issues.length === 1 ? '' : 's'} (${critical} critical, ${r.issues.length - critical} informational)`
  return [
    `## Local review (${gstack ? 'gstack /review checklist' : 'pre-landing checklist'} · \`${r.model}\`)`,
    '',
    head,
    ...r.issues.flatMap(i => [
      `- **${i.severity}** \`${i.file}${i.line ? `:${i.line}` : ''}\`: ${i.problem.replace(/`/g, "'")}`,
      ...(i.fix ? [`  Recommended fix: ${i.fix.replace(/`/g, "'")}`] : []),
    ]),
    '',
    `<sub>${whyNotCopilot}, so the factory's local AI stack reviewed this PR instead. Advisory only: it can't approve or block.${r.dropped ? ` ${r.dropped} finding(s) about files outside the diff were dropped.` : ''}</sub>`,
  ].join('\n')
}

/** Run the review through LiteLLM. Null when no reviewer is configured or the call fails. */
export async function runLocalReview(
  cfg: Pick<FactoryConfig, 'litellm' | 'judge'>, builder: ModelTier, task: Pick<FactoryTask, 'objective'>, patch: string,
  opts: { checklist?: string | null; fetchImpl?: typeof fetch } = {},
): Promise<LocalReview | null> {
  const model = reviewerModel(builder, cfg)
  if (!model) return null
  const started = Date.now()
  try {
    const res = await (opts.fetchImpl ?? fetch)(`${cfg.litellm.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.litellm.key}` },
      body: JSON.stringify({
        model, temperature: 0, max_tokens: 1500,
        messages: [{ role: 'user', content: buildLocalReviewPrompt(task, patch, checklistText(opts.checklist ?? null)) }],
      }),
      signal: AbortSignal.timeout(cfg.judge.adversarial.timeoutMs),
    })
    if (!res.ok) return null
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const parsed = parseLocalReview(body.choices?.[0]?.message?.content ?? '', patch)
    return parsed ? { model, ...parsed, durationMs: Date.now() - started } : null
  } catch {
    return null
  }
}

export async function commentOnPr(url: string, body: string): Promise<boolean> {
  return (await run('gh', ['pr', 'comment', url, '--body-file', '-'], { input: body, timeoutMs: 60_000 })).code === 0
}
