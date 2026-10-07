import { run } from './proc'
import { summarizeCopilotReview, type PrReviewSummary } from './git'

/** Ask GitHub Copilot code review for an independent review (the Reviewer role). */
export async function requestCopilotReview(url: string): Promise<boolean> {
  // Copilot review is a feature of your Copilot seat: request it with your own login, not the factory's app.
  const r = await run('gh', ['pr', 'edit', url, '--add-reviewer', '@copilot'], { timeoutMs: 60_000, env: { GH_TOKEN: '' } })
  return r.code === 0
}

/** Copilot's review on a PR: review summary + inline (line) comment count. */
export async function copilotReview(url: string): Promise<PrReviewSummary> {
  const v = await run('gh', ['pr', 'view', url, '--json', 'reviews,comments'], { timeoutMs: 60_000 })
  const summary = v.code === 0 ? summarizeCopilotReview(JSON.parse(v.output)) : { reviewed: false, comments: 0, highlights: [] }
  const m = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(url)
  if (m) {
    const c = await run('gh', ['api', `repos/${m[1]}/${m[2]}/pulls/${m[3]}/comments`, '--jq', '[.[] | select(.user.login | test("copilot"; "i"))] | length'], { timeoutMs: 60_000 })
    summary.comments = c.code === 0 ? Number(c.output.trim()) || 0 : 0
  }
  return summary
}
