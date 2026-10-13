/**
 * The weekly AI run for one user (the digest cron): the digest first, then the Advisor, the CEO report
 * and the attempt distiller together. The Advisor and CEO report attach to the newest digest row, so
 * running them alongside the digest could put them on last week's row. Returns what failed, in words:
 * the cron used to run all four under Promise.allSettled and answer "ok" whatever happened, so a free
 * tier's "high demand" left the 2026-10-12 digest unwritten without a trace.
 */
import { describeAiError } from './errors'

type Step = (userId: string) => Promise<unknown>

export async function runWeeklyAi(userId: string, steps: { digest: Step; advisor: Step; ceoReport: Step; distill: Step }): Promise<string[]> {
  const failed: string[] = []
  const record = (name: string, err: unknown) => failed.push(`${name}: ${describeAiError(err)}`)
  await steps.digest(userId).catch(err => record('digest', err))
  const rest = [['Advisor', steps.advisor], ['CEO report', steps.ceoReport], ['attempt distiller', steps.distill]] as const
  const results = await Promise.allSettled(rest.map(([, step]) => step(userId)))
  results.forEach((r, i) => { if (r.status === 'rejected') record(rest[i]![0], r.reason) })
  return failed
}
