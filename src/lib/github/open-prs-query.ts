import 'server-only'

import { and, eq, isNotNull, isNull } from 'drizzle-orm'
import { db } from '@/lib/db'
import { agentJobs, users } from '@/lib/db/schema'
import { decrypt } from '@/lib/crypto-utils'
import { createOctokit } from '@/lib/github/client'
import { prSource, sortForReview, type OpenPr, type PrSource } from '@/lib/agents/open-prs'

export interface OpenPrRow extends OpenPr {
  source: PrSource
}

export type OpenPrsResult = { ok: true; prs: OpenPrRow[]; total: number } | { ok: false; reason: string }

/**
 * Every open PR in the user's own non-archived repos (one GitHub search call), oldest first,
 * tagged by who opened it. Factory PRs are recognised from `agent_jobs`, since the factory
 * opens them with the owner's own `gh` login.
 */
export async function loadOpenPrs(userId: string, limit = 50): Promise<OpenPrsResult> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId), columns: { githubLogin: true, githubToken: true } })
  if (!user?.githubLogin || !user.githubToken) return { ok: false, reason: 'GitHub account not connected' }
  try {
    const octokit = createOctokit(decrypt(user.githubToken))
    const [res, jobs] = await Promise.all([
      octokit.request('GET /search/issues', {
        q: `is:pr is:open archived:false user:${user.githubLogin}`, sort: 'created', order: 'asc', per_page: limit,
      }),
      db.select({ prUrl: agentJobs.prUrl }).from(agentJobs)
        .where(and(eq(agentJobs.userId, userId), isNotNull(agentJobs.prUrl), isNull(agentJobs.outcome))),
    ])
    const factoryUrls = new Set(jobs.flatMap(j => (j.prUrl ? [j.prUrl] : [])))
    const prs = res.data.items.map((i): OpenPr => ({
      repo: i.repository_url.split('/repos/')[1] ?? i.repository_url,
      number: i.number, title: i.title, url: i.html_url, author: i.user?.login ?? 'unknown',
      createdAt: new Date(i.created_at), isDraft: i.draft ?? false,
      labels: i.labels.flatMap(l => (typeof l === 'string' ? [l] : l.name ? [l.name] : [])),
    }))
    return {
      ok: true, total: res.data.total_count,
      prs: sortForReview(prs).map(p => ({ ...p, source: prSource(p, { ownerLogin: user.githubLogin, factoryUrls }) })),
    }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'GitHub search failed' }
  }
}
