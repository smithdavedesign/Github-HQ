import type { ModelTier } from '../../src/lib/agents/model-router'
import type { FactoryConfig } from './config'
import type { FactoryTask } from './tasks'

/**
 * Advisory adversarial review (roadmap Phase 77, docs/autonomous-factory.md §14.1 #4).
 *
 * Runs only after the deterministic judge has passed. A model from a different family than the
 * builder is asked to argue the PR should NOT merge. It can never approve anything:
 *   PASS      → nothing happens
 *   UNCERTAIN → the PR gets the `needs-careful-review` label
 *   FAIL      → the same label, or a rejection once the `adversarial-veto` capability is at `pr`
 * Each issue must quote the diff as evidence; an issue whose quote isn't in the diff is dropped
 * (a FAIL left with no evidenced issue becomes UNCERTAIN). It runs on the host and only sends
 * the diff text to LiteLLM; no repo code runs.
 */

export type AdversaryVerdict = 'PASS' | 'FAIL' | 'UNCERTAIN'

export interface AdversaryIssue { question: string; evidence: string; why: string }

export interface AdversaryResult {
  model: string
  verdict: AdversaryVerdict
  issues: AdversaryIssue[]
  /** Issues dropped because their evidence wasn't in the diff. */
  dropped: number
  durationMs: number
}

export const NEEDS_REVIEW_LABEL = 'needs-careful-review'

export const CHECKLIST = [
  'What behaviour changed, and is that change what the task asked for?',
  'What existing behaviour could regress?',
  'Do the tests actually exercise the change, or were they bypassed?',
  'Were files, functions or exports deleted that the task did not require?',
  'Were dependencies, scripts, commands or APIs invented?',
  'Does the change follow the patterns already used in this repository?',
  'Does the change claim success without evidence (e.g. a check made to pass rather than fixed)?',
  'Is the diff larger than the fix needs?',
  'Does it hide an error (catch-and-ignore, defaults that mask failures, `any`/casts)?',
  'Could it change security, auth, data or money handling?',
]

/** Reviewer per builder tier: always a different model family from the builder. */
export function reviewerModel(builder: ModelTier, cfg: Pick<FactoryConfig, 'judge'>): string | null {
  return cfg.judge.adversarial.reviewers[builder] ?? null
}

/**
 * Extra request fields for a reviewer alias. The local reviewers run thinking models (Qwen3) on
 * Ollama, which spend the whole token budget reasoning and return empty content, so every review
 * came back unparseable and silently skipped (found 2026-10-07). LiteLLM turns
 * `reasoning_effort: "none"` into Ollama's thinking switch. Cloud aliases don't get it: some
 * providers reject the parameter.
 */
export function reviewerRequestExtras(model: string): { reasoning_effort?: 'none' } {
  return model.startsWith('local-') ? { reasoning_effort: 'none' } : {}
}

export const MAX_DIFF_CHARS = 24_000

export function buildAdversaryPrompt(task: FactoryTask, patch: string): string {
  return [
    'You are the reviewer whose job is to find reasons this pull request should NOT be merged.',
    'It was written by another AI model and has already passed the repository\'s own checks.',
    `Task it was given: ${task.objective}`,
    '',
    'Answer each question by looking only at the diff below:',
    ...CHECKLIST.map((q, i) => `${i + 1}. ${q}`),
    '',
    'Reply with ONE JSON object and nothing else:',
    '{"verdict":"PASS"|"FAIL"|"UNCERTAIN","issues":[{"question":<number>,"evidence":"<exact text copied from the diff>","why":"<one sentence>"}]}',
    '- FAIL: at least one concrete problem you can quote from the diff.',
    '- UNCERTAIN: something looks risky but you cannot show it from the diff.',
    '- PASS: no problems found. Do not invent issues; "evidence" must be copied verbatim from the diff.',
    '',
    'Diff:',
    '```diff',
    patch.length > MAX_DIFF_CHARS ? `${patch.slice(0, MAX_DIFF_CHARS)}\n… (diff truncated)` : patch,
    '```',
  ].join('\n')
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()
/** Diff text without the per-line +/-/space markers, so quotes spanning lines still match. */
const unmark = (s: string) => s.split('\n').map(l => l.replace(/^[+\- ]/, '')).join('\n')

/** Parse the model's reply. Anything malformed yields null: no signal, never a block. */
export function parseAdversaryReply(reply: string, patch: string): Omit<AdversaryResult, 'model' | 'durationMs'> | null {
  const text = reply.replace(/<think>[\s\S]*?<\/think>/gi, '')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let j: { verdict?: unknown; issues?: unknown }
  try { j = JSON.parse(text.slice(start, end + 1)) } catch { return null }
  const verdict = typeof j.verdict === 'string' ? j.verdict.toUpperCase() : ''
  if (verdict !== 'PASS' && verdict !== 'FAIL' && verdict !== 'UNCERTAIN') return null
  const haystack = squash(unmark(patch))
  const raw = Array.isArray(j.issues) ? j.issues : []
  const issues: AdversaryIssue[] = []
  for (const i of raw as { question?: unknown; evidence?: unknown; why?: unknown }[]) {
    const evidence = typeof i?.evidence === 'string' ? unmark(i.evidence) : ''
    // A quote must be long enough to mean something and actually be in the diff.
    if (squash(evidence).length >= 8 && haystack.includes(squash(evidence))) {
      issues.push({ question: String(i.question ?? ''), evidence: evidence.slice(0, 200), why: String(i.why ?? '').slice(0, 300) })
    }
  }
  const dropped = raw.length - issues.length
  const effective: AdversaryVerdict = verdict === 'FAIL' && issues.length === 0 ? 'UNCERTAIN' : verdict
  return { verdict: effective, issues, dropped }
}

/** One chat call through LiteLLM. Never throws: any failure means "no advisory signal". */
export async function runAdversary(
  cfg: Pick<FactoryConfig, 'litellm' | 'judge'>, builder: ModelTier, task: FactoryTask, patch: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AdversaryResult | null> {
  const model = reviewerModel(builder, cfg)
  if (!model || !cfg.judge.adversarial.enabled) return null
  const started = Date.now()
  try {
    const res = await fetchImpl(`${cfg.litellm.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${cfg.litellm.key}` },
      body: JSON.stringify({ model, temperature: 0, max_tokens: 1500, ...reviewerRequestExtras(model), messages: [{ role: 'user', content: buildAdversaryPrompt(task, patch) }] }),
      signal: AbortSignal.timeout(cfg.judge.adversarial.timeoutMs),
    })
    if (!res.ok) return null
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const parsed = parseAdversaryReply(body.choices?.[0]?.message?.content ?? '', patch)
    return parsed ? { model, ...parsed, durationMs: Date.now() - started } : null
  } catch {
    return null
  }
}

/** What the factory does with a result, given the `adversarial-veto` capability stage. */
export function adversaryAction(r: AdversaryResult | null, vetoStage: 'observe' | 'report' | 'pr'): 'none' | 'label' | 'reject' {
  if (!r || r.verdict === 'PASS') return 'none'
  if (r.verdict === 'FAIL' && vetoStage === 'pr') return 'reject'
  return 'label'
}

export function adversarySection(r: AdversaryResult | null): string[] {
  if (!r) return []
  return [
    '',
    `## Adversarial review (advisory · \`${r.model}\`)`,
    `Verdict: **${r.verdict}**${r.dropped ? ` · ${r.dropped} unsupported claim(s) dropped` : ''}`,
    ...r.issues.map(i => `- Q${i.question}: ${i.why} — \`${i.evidence.replace(/`/g, "'").slice(0, 120)}\``),
  ]
}
