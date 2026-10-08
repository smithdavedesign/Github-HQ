/**
 * Open PRs waiting for the owner, across every repo they own, so none get lost: factory drafts,
 * Dependabot, other bots and their own. The dashboard reads them through the GitHub search API
 * (open-prs-query.ts), the morning report through `gh search prs`.
 *
 * Pure, relative imports only: the factory and the app both use it.
 */

export interface OpenPr {
  repo: string
  number: number
  title: string
  url: string
  author: string
  createdAt: Date
  isDraft: boolean
  labels: string[]
}

export type PrSource = 'factory' | 'dependabot' | 'bot' | 'owner' | 'other'

export const PR_SOURCE_LABEL: Record<PrSource, string> = {
  factory: 'factory', dependabot: 'Dependabot', bot: 'bot', owner: 'you', other: 'contributor',
}

/** A PR open this many days or longer is flagged as aging. */
export const AGING_PR_DAYS = 7

const DAY = 86_400_000

export function prSource(pr: Pick<OpenPr, 'author' | 'url'>, opts: { ownerLogin?: string | null; factoryUrls?: ReadonlySet<string> } = {}): PrSource {
  if (opts.factoryUrls?.has(pr.url)) return 'factory'
  // gh prints GitHub Apps as `app/<slug>`, the REST API as `<slug>[bot]`.
  const a = pr.author.toLowerCase()
  if (a.replace(/^app\//, '').startsWith('dependabot')) return 'dependabot'
  if (a.endsWith('[bot]') || a.startsWith('app/') || a.endsWith('-bot')) return 'bot'
  if (opts.ownerLogin && a === opts.ownerLogin.toLowerCase()) return 'owner'
  return 'other'
}

export function prAgeDays(pr: Pick<OpenPr, 'createdAt'>, now: Date): number {
  return Math.max(0, Math.floor((now.getTime() - pr.createdAt.getTime()) / DAY))
}

/** Oldest first: the ones most likely to be forgotten lead. */
export function sortForReview<T extends Pick<OpenPr, 'createdAt' | 'url'>>(prs: readonly T[]): T[] {
  return [...prs].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.url.localeCompare(b.url))
}

/** `gh search prs --json repository,number,title,url,author,createdAt,isDraft,labels` → OpenPr[]. */
export function parseGhSearchPrs(json: string): OpenPr[] {
  let rows: unknown
  try { rows = JSON.parse(json) } catch { return [] }
  if (!Array.isArray(rows)) return []
  return rows.flatMap((r): OpenPr[] => {
    const x = r as {
      repository?: { nameWithOwner?: string }; number?: number; title?: string; url?: string
      author?: { login?: string }; createdAt?: string; isDraft?: boolean; labels?: { name?: string }[]
    }
    if (!x.url || !x.repository?.nameWithOwner || typeof x.number !== 'number' || !x.createdAt) return []
    return [{
      repo: x.repository.nameWithOwner, number: x.number, title: x.title ?? '', url: x.url,
      author: x.author?.login ?? 'unknown', createdAt: new Date(x.createdAt), isDraft: x.isDraft ?? false,
      labels: (x.labels ?? []).flatMap(l => (l.name ? [l.name] : [])),
    }]
  })
}
