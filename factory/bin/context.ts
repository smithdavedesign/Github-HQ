/**
 * The context index (factory/context): one searchable view of repos, ideas, bookmarks and docs,
 * tagged by data class (docs/personal-context.md). Built daily with the morning report.
 *   npm run context -- build
 *   npm run context -- search "<query>" [--classes public,personal] [--sources repo,idea,bookmark,doc] [--limit 10] [--json]
 *   npm run context -- interests      # the owner's interests from bookmarks (steers idea research)
 *   npm run context -- overview       # a short brief of the whole system
 * Work-class entries are only returned with --classes including "work", for local models only.
 * Financial entries are never indexed.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { loadConfig } from '../lib/config'
import { buildIndex, interests, overview, search, type ContextIndex, type DataClass, type Source } from '../context/index'
import { loadBookmarks, loadDocs, loadIdeas, loadRepos } from '../context/sources'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..')
const args = process.argv.slice(2)
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }

export function indexPath(home: string) { return path.join(home, 'context', 'index.json') }

export async function buildContextIndex(home: string, ideaHome = process.env.IDEA_HOME ?? path.join(process.env.HOME ?? '', 'idea-factory')) {
  const cfg = loadConfig()
  const results = [await loadRepos(cfg), loadIdeas(ideaHome), await loadBookmarks(), loadDocs(ROOT)]
  const index = buildIndex(results.flatMap(r => r.entries))
  const errors = results.flatMap(r => r.errors)
  mkdirSync(path.dirname(indexPath(home)), { recursive: true })
  // Holds work-class entries: owner-only file.
  writeFileSync(indexPath(home), JSON.stringify({ ...index, errors }), { mode: 0o600 })
  return { counts: index.counts, errors, path: indexPath(home) }
}

function load(home: string): ContextIndex {
  if (!existsSync(indexPath(home))) throw new Error('no context index yet: run `npm run context -- build`')
  return JSON.parse(readFileSync(indexPath(home), 'utf8'))
}

async function main() {
  const cfg = loadConfig()
  const [cmd, ...rest] = args
  if (cmd === 'build') return console.log(JSON.stringify(await buildContextIndex(cfg.home), null, 1))
  const index = load(cfg.home)
  if (cmd === 'search') {
    const query = rest.filter(a => !a.startsWith('--') && ![flag('--classes'), flag('--sources'), flag('--limit')].includes(a)).join(' ')
    const hits = search(index, query, {
      classes: flag('--classes')?.split(',') as DataClass[] | undefined,
      sources: flag('--sources')?.split(',') as Source[] | undefined,
      limit: Number(flag('--limit') ?? 10),
    })
    if (args.includes('--json')) return console.log(JSON.stringify(hits.map(h => ({ score: h.score, ...h.entry })), null, 1))
    return console.log(hits.map(h => `[${h.entry.source}/${h.entry.dataClass}] ${h.entry.title} (${h.score})\n  ${h.entry.text.slice(0, 220)}${h.entry.url ? `\n  ${h.entry.url}` : ''}`).join('\n') || 'no matches')
  }
  if (cmd === 'interests') return console.log(JSON.stringify(interests(index), null, 1))
  if (cmd === 'overview') return console.log(overview(index))
  throw new Error('usage: context build | search "<query>" [--classes …] [--sources …] [--limit n] [--json] | interests | overview')
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1 })
