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
import { buildMorningReport, cycleLogEntry, emailFailureReason, isCycleLog, toMime, type MorningReport, type RoleId, type RoleSection } from './lib/report'
import { factoryActivityOf, latestHealthSnapshot, recentSyncs, recordNotification, repoSignalsOf, requestOutcomes } from './lib/sink'
import { parseGhSearchPrs, type OpenPr } from '../src/lib/agents/open-prs'
import { nextActions } from '../src/lib/portfolio/next-actions'
import { runPreflight } from './lib/preflight'
import { copilotQuota } from './lib/copilot-quota'
import { inactivityDisabled, type SystemHealth } from './lib/system-health'

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
    systemHealth: await gatherSystemHealth(cfg, now),
    openPrsAll: await openPrsAcross(cfg),
    ownerLogin: await ownerLogin(),
    nextActions: await repoSignalsOf(cfg, now).then(rows => (rows ? nextActions(rows) : null)),
    preflight: await runPreflight(cfg).catch(() => []),
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
  const email = await sendEmail(cfg, report, now)
  if (!email.sent) {
    await recordNotification(cfg, report.subject, `Morning report saved to ${stem}.html (not emailed: ${email.reason}).`)
  }
}

/**
 * Every open, non-archived PR in repos owned by the allowlist's owners (one `gh search prs` per
 * owner), not just the factory's, so Dependabot and your own PRs don't get lost either.
 * null when any search fails: a partial list would read as "nothing else is open".
 */
async function openPrsAcross(cfg: FactoryConfig): Promise<OpenPr[] | null> {
  const owners = [...new Set(cfg.repos.map(r => r.split('/')[0]).filter(Boolean))]
  const out: OpenPr[] = []
  for (const owner of owners) {
    // Your own login: the factory's GitHub App only sees the allowlisted repos, and this lists every repo you own.
    const r = await run('gh', ['search', 'prs', '--owner', owner, '--state', 'open', '--archived=false', '--limit', '100',
      '--json', 'repository,number,title,url,author,createdAt,isDraft,labels'], { timeoutMs: 60_000, env: { GH_TOKEN: '' } })
    if (r.code !== 0) return null
    out.push(...parseGhSearchPrs(r.output))
  }
  return out
}

async function ownerLogin(): Promise<string | null> {
  const r = await run('gh', ['api', 'user', '--jq', '.login'], { timeoutMs: 30_000, env: { GH_TOKEN: '' } })
  return r.code === 0 && r.output.trim() ? r.output.trim() : null
}

/** Never throws: every probe degrades to null/unknown. */
async function gatherSystemHealth(cfg: FactoryConfig, now: Date): Promise<SystemHealth> {
  const lists = await Promise.all(cfg.repos.map(async repo => {
    const r = await run('gh', ['workflow', 'list', '--repo', repo, '--all', '--json', 'name,state'], { timeoutMs: 30_000 })
    if (r.code !== 0) return null
    try { return inactivityDisabled(repo, JSON.parse(r.output)) } catch { return null }
  }))
  const [latestSnapshot, requests, factory, syncs] = await Promise.all([
    latestHealthSnapshot(cfg),
    requestOutcomes(cfg, new Date(now.getTime() - 7 * 86_400_000), now),
    factoryActivityOf(cfg),
    recentSyncs(cfg),
  ])
  return { disabledWorkflows: lists.every(l => l === null) ? null : lists.flatMap(l => l ?? []), latestSnapshot, requests, factory, syncs }
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

/**
 * Waits before each retry. The 06:45 report can land on a Mac that just woke without network
 * (2026-10-06: the one send hung 15 minutes and failed with no message), so one try isn't enough.
 */
const EMAIL_RETRY_WAITS_MS = [60_000, 3 * 60_000, 6 * 60_000]

async function sendEmail(cfg: FactoryConfig, report: MorningReport, now: Date): Promise<{ sent: true } | { sent: false; reason: string }> {
  const to = process.env.FACTORY_REPORT_EMAIL
  const himalayaConfig = path.join(cfg.home, 'himalaya.toml')
  if (!to || !existsSync(himalayaConfig)) {
    log('email not configured (FACTORY_REPORT_EMAIL + ~/.repohq-factory/himalaya.toml) — saved only')
    return { sent: false, reason: 'email not configured — run factory/bin/setup-email.sh' }
  }
  const from = process.env.FACTORY_REPORT_FROM ?? to
  const mime = toMime(report, from, to, now)
  let reason = ''
  for (let attempt = 0; attempt <= EMAIL_RETRY_WAITS_MS.length; attempt++) {
    if (attempt > 0) {
      const wait = EMAIL_RETRY_WAITS_MS[attempt - 1]
      log(`email attempt ${attempt} failed (${reason}) — retrying in ${wait / 60_000} min`)
      await new Promise(resolve => setTimeout(resolve, wait))
    }
    const r = await run('himalaya', ['-c', himalayaConfig, 'message', 'send'], { input: mime, timeoutMs: 60_000 })
    if (r.code === 0) {
      log(`emailed ${to}${attempt > 0 ? ` (attempt ${attempt + 1})` : ''}`)
      return { sent: true }
    }
    reason = emailFailureReason(r)
  }
  log(`email failed after ${EMAIL_RETRY_WAITS_MS.length + 1} attempts: ${reason}`)
  return { sent: false, reason }
}

/** Cycle runs in the last 24h, from their logs (the worker's and the old launchd calendar's). */
function recentCycles(cfg: FactoryConfig, now: Date): { at: string; exit: number | null }[] {
  const dir = path.join(cfg.home, 'logs')
  if (!existsSync(dir)) return []
  return readdirSync(dir).flatMap(f => {
    if (!isCycleLog(f)) return []
    const entry = cycleLogEntry(readFileSync(path.join(dir, f), 'utf8'))
    return entry && now.getTime() - new Date(entry.at).getTime() <= 86_400_000 ? [entry] : []
  })
}

main().catch(err => {
  console.error('[report] failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
