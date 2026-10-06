/**
 * Morning report — one update per gstack role, emailed to the owner.
 *
 *   npx tsx factory/report.ts               # build, save, email (if configured)
 *   npx tsx factory/report.ts --no-send     # build + save only (prints the text version)
 *   npx tsx factory/report.ts --headlines   # add local-model one-liners (off by default: they paraphrase loosely)
 *
 * Email: himalaya + Gmail SMTP with an app password kept in the login keychain
 * (one-time `bash factory/bin/setup-email.sh`). Without it the report is saved to
 * ~/.repohq-factory/reports/ and surfaced as a RepoHQ notification.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { extractJson } from '../src/lib/ai/structured'
import { loadConfig, type FactoryConfig } from './lib/config'
import { monthToDateUsd, readLedger, todaysUsage } from './lib/ledger'
import { readManagedModels } from './lib/litellm-config'
import { listAliases } from './lib/litellm-ops'
import { run } from './lib/proc'
import { freeQuota } from './lib/quota'
import { buildMorningReport, toMime, type MorningReport, type RoleId, type RoleSection } from './lib/report'
import { recordNotification } from './lib/sink'
import { copilotQuota } from './lib/copilot-quota'

const log = (...a: unknown[]) => console.log(`[report ${new Date().toISOString().slice(11, 19)}]`, ...a)

async function main() {
  const argv = process.argv.slice(2)
  const cfg = loadConfig()
  const now = new Date()
  const entries = readLedger(cfg.home)
  const usage = todaysUsage(entries, now)
  const aliases = await listAliases(cfg).catch((): string[] => [])

  const input = {
    now,
    entries,
    repos: cfg.repos,
    pool: existsSync(cfg.litellm.configPath) ? readManagedModels(readFileSync(cfg.litellm.configPath, 'utf8')) : {},
    liteLLMUp: aliases.length > 0,
    openRouterQuota: await freeQuota(cfg),
    copilot: { ...cfg.copilot, tasksToday: usage.copilotTasks, reviewsToday: usage.copilotReviews, quota: await copilotQuota() },
    prTarget: { min: 3, max: cfg.maxPrsPerDay },
    capabilities: cfg.capabilities,
    monthToDateUsd: monthToDateUsd(entries, now),
    monthlyBudgetUsd: cfg.monthlyBudgetUsd,
    cycles: recentCycles(cfg, now),
  }
  let report = buildMorningReport(input)
  // Opt-in: the local 7B model mis-paraphrased numbers in testing ("4 of 8 reviews completed"
  // for 4 *requested*), and a report the owner trusts can't misstate its own facts.
  if (argv.includes('--headlines') && input.liteLLMUp) {
    const headlines = await writeHeadlines(cfg, report.sections)
    if (headlines) report = buildMorningReport({ ...input, headlines })
  }

  const dir = path.join(cfg.home, 'reports')
  mkdirSync(dir, { recursive: true })
  const stem = path.join(dir, now.toLocaleDateString('en-CA'))
  writeFileSync(`${stem}.html`, report.html)
  writeFileSync(`${stem}.txt`, report.text)
  log(`saved ${stem}.html`)

  if (argv.includes('--no-send')) {
    console.log(`\n${report.text}`)
    return
  }
  const sent = await sendEmail(cfg, report, now)
  if (!sent) {
    await recordNotification(cfg, report.subject, `Morning report saved to ${stem}.html (email not configured — run factory/bin/setup-email.sh).`)
  }
}

/** One local-model call (routine work → Ollama, $0) that rephrases each role's facts as a headline. */
async function writeHeadlines(cfg: FactoryConfig, sections: RoleSection[]): Promise<Partial<Record<RoleId, string>> | null> {
  const facts = Object.fromEntries(sections.map(s => [s.id, { role: s.role, facts: s.lines }]))
  try {
    const r = await fetch(`${cfg.litellm.url}/v1/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cfg.litellm.key}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(180_000),
      body: JSON.stringify({
        model: 'local-small',
        max_tokens: 800,
        messages: [
          { role: 'system', content: 'You write one-sentence status headlines for an engineering team update. Use ONLY the facts given; never add numbers, names or claims that are not in the facts. Each headline is at most 20 words, first person, in the voice of that role. Reply with a JSON object mapping each role id to its headline, nothing else.' },
          { role: 'user', content: JSON.stringify(facts) },
        ],
      }),
    })
    if (!r.ok) return null
    const j = (await r.json()) as { choices?: { message?: { content?: string } }[] }
    const parsed = extractJson(j.choices?.[0]?.message?.content ?? '') as Record<string, unknown>
    const out: Partial<Record<RoleId, string>> = {}
    for (const s of sections) {
      const h = parsed?.[s.id]
      if (typeof h === 'string' && h.length > 0 && h.length <= 200) out[s.id] = h.trim()
    }
    return Object.keys(out).length > 0 ? out : null
  } catch {
    return null
  }
}

async function sendEmail(cfg: FactoryConfig, report: MorningReport, now: Date): Promise<boolean> {
  const to = process.env.FACTORY_REPORT_EMAIL
  const himalayaConfig = path.join(cfg.home, 'himalaya.toml')
  if (!to || !existsSync(himalayaConfig)) {
    log('email not configured (FACTORY_REPORT_EMAIL + ~/.repohq-factory/himalaya.toml) — saved only')
    return false
  }
  const from = process.env.FACTORY_REPORT_FROM ?? to
  const r = await run('himalaya', ['-c', himalayaConfig, 'message', 'send'], { input: toMime(report, from, to, now), timeoutMs: 60_000 })
  if (r.code !== 0) {
    log(`email failed: ${r.output.trim().split('\n').slice(-2).join(' | ')}`)
    return false
  }
  log(`emailed ${to}`)
  return true
}

/** Cycle runs in the last 24h, from the launchd wrapper's logs. */
function recentCycles(cfg: FactoryConfig, now: Date): { at: string; exit: number | null }[] {
  const dir = path.join(cfg.home, 'logs')
  if (!existsSync(dir)) return []
  return readdirSync(dir).filter(f => /^cycle-\d{8}-\d{6}\.log$/.test(f)).flatMap(f => {
    const text = readFileSync(path.join(dir, f), 'utf8')
    const at = /=== cycle (\S+) ===/.exec(text)?.[1]
    if (!at || now.getTime() - new Date(at).getTime() > 86_400_000) return []
    const exit = /=== exit (\d+) ===/.exec(text)?.[1]
    return [{ at, exit: exit === undefined ? null : Number(exit) }]
  })
}

main().catch(err => {
  console.error('[report] failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
