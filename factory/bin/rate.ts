/**
 * Rate a coding task's difficulty 1–3 with the tier advisor (lib/tier-advisor.ts). For callers
 * outside the factory, such as idea-factory's milestone builds.
 *   npm run factory:rate -- --kind idea-milestone --title "M2: accounts" --objective-file ROADMAP-M2.md
 *   npm run factory:rate -- --kind owner-requested --title "…" --objective "…"
 * Prints {difficulty, reason, source, model}. Local model only: safe for private and work code.
 */
import { readFileSync } from 'node:fs'
import { loadConfig } from '../lib/config'
import { rateTask } from '../lib/tier-advisor'

const args = process.argv.slice(2)
const flag = (name: string) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined }

async function main() {
  const cfg = loadConfig()
  const objective = flag('--objective') ?? (flag('--objective-file') ? readFileSync(flag('--objective-file')!, 'utf8') : '')
  const title = flag('--title') ?? ''
  if (!title && !objective) throw new Error('usage: factory:rate -- --kind <kind> --title "<title>" (--objective "<text>" | --objective-file <path>)')
  console.log(JSON.stringify(await rateTask(cfg, { kind: flag('--kind') ?? 'owner-requested', title, objective, repo: flag('--repo') })))
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1 })
