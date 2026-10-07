/**
 * Morning report — one update per gstack role, built from the factory's own records.
 * Pure: data in, email out. Every number comes from the ledger / live probes; the
 * optional one-line role headlines (written by the local model) only rephrase them.
 */
import type { ModelTier } from '../../src/lib/agents/model-router'
import { systemHealthLines, type SystemHealth } from './system-health'
import type { Capability, CapabilityStage } from './config'
import { ladderStatus } from './ladder'
import type { AttemptEntry, CiOracleEntry, LedgerEntry, ResolutionEntry, ReviewEntry, ScanEntry, SignalsEntry } from './ledger'
import { rankOpportunities } from './sensors'
import { computeFactoryKpis, kpiHeadline } from '../../src/lib/agents/factory-kpis'
import { toJobRecords } from './ledger'
import { kpiTrend, nightShiftReadiness, readinessLine } from './night-shift'

export interface ReportInput {
  now: Date
  entries: LedgerEntry[]
  /** Allowlisted repos — scans of repos removed from the allowlist are ignored. */
  repos: string[]
  /** alias → pool id, from the managed LiteLLM block. */
  pool: Record<string, string>
  liteLLMUp: boolean
  openRouterQuota: { remaining: number; limit: number } | null
  copilot: { enabled: boolean; model: string; tasksToday: number; maxTasksPerDay: number; reviewsToday: number; maxReviewsPerDay: number
    /** Premium requests left this month (null = unknown). */
    quota?: { percentRemaining: number; resetDate: string | null } | null }
  prTarget: { min: number; max: number }
  monthToDateUsd: number
  monthlyBudgetUsd: number
  /** Cycle runs in the last 24h (from the launchd logs): exit codes. */
  cycles: { at: string; exit: number | null }[]
  /** Optional one-line headline per role id. */
  headlines?: Partial<Record<RoleId, string>>
  /** Capability stages (promotion ladder, Phase 75). */
  capabilities?: Record<Capability, CapabilityStage>
  /** Disabled workflows, stale RepoHQ data, failing or stuck agent requests (factory/lib/system-health.ts). */
  systemHealth?: SystemHealth
}

export type RoleId = 'pm' | 'architect' | 'builder' | 'qa' | 'reviewer' | 'security' | 'ops' | 'retro' | 'ladder'

export interface RoleSection {
  id: RoleId
  role: string
  /** gstack skill whose job this role mirrors. */
  skill: string
  title: string
  lines: string[]
}

export interface MorningReport {
  subject: string
  sections: RoleSection[]
  text: string
  html: string
}

const DAY = 86_400_000
const isAttempt = (e: LedgerEntry): e is AttemptEntry => e.type === 'attempt'
const isScan = (e: LedgerEntry): e is ScanEntry => e.type === 'scan'
const since = (iso: string, now: Date, ms: number) => now.getTime() - new Date(iso).getTime() <= ms
const short = (repo: string) => repo.split('/')[1] ?? repo
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

/** Latest scan per repo (allowlisted repos only, when an allowlist is given). */
export function latestScans(entries: LedgerEntry[], repos?: string[]): ScanEntry[] {
  const by = new Map<string, ScanEntry>()
  for (const s of entries.filter(isScan).filter(s => !repos || repos.includes(s.repo))) {
    const prev = by.get(s.repo)
    if (!prev || s.at > prev.at) by.set(s.repo, s)
  }
  return [...by.values()].sort((a, b) => a.repo.localeCompare(b.repo))
}

const KIND_PRIORITY = ['red-ci', 'fix-types', 'lint-autofix', 'fix-lint', 'fix-tests', 'deps-audit', 'docs-readme']
const KIND_LABEL: Record<string, string> = {
  'fix-types': 'fix type errors', 'lint-autofix': 'apply lint autofix', 'fix-lint': 'fix lint errors', 'fix-tests': 'fix failing tests',
  'deps-audit': 'patch vulnerable dependencies', 'docs-readme': 'fill README gaps', 'red-ci': 'fix red CI',
}

/** PM backlog: open work from the latest scans, minus kinds with an open PR. */
export function backlog(entries: LedgerEntry[], repos?: string[]): { repo: string; kind: string }[] {
  const resolved = new Set(entries.filter((e): e is ResolutionEntry => e.type === 'resolution').map(r => r.attemptId))
  const openKinds = new Set(entries.filter(isAttempt).filter(a => a.prUrl && !resolved.has(a.id)).map(a => `${a.repo}:${a.kind}`))
  return latestScans(entries, repos)
    .flatMap(s => s.tasks.map(kind => ({ repo: s.repo, kind })))
    .filter(t => !openKinds.has(`${t.repo}:${t.kind}`))
    .sort((a, b) => KIND_PRIORITY.indexOf(a.kind) - KIND_PRIORITY.indexOf(b.kind) || a.repo.localeCompare(b.repo))
}

export function buildMorningReport(input: ReportInput): MorningReport {
  const { now, entries } = input
  const attempts = entries.filter(isAttempt)
  const last24 = attempts.filter(a => since(a.at, now, DAY))
  const last7 = attempts.filter(a => since(a.at, now, 7 * DAY))
  const resolutions = new Map(entries.filter((e): e is ResolutionEntry => e.type === 'resolution').map(r => [r.attemptId, r]))
  const reviews = new Map(entries.filter((e): e is ReviewEntry => e.type === 'review').map(r => [r.attemptId, r]))
  const openPrs = attempts.filter(a => a.prUrl && !resolutions.has(a.id))
  const newPrs = last24.filter(a => a.prUrl)
  const scans = latestScans(entries, input.repos)
  const todo = backlog(entries, input.repos)
  const signals = new Map<string, SignalsEntry>()
  for (const e of entries) if (e.type === 'signals' && input.repos.includes(e.repo) && (!signals.get(e.repo) || e.at > signals.get(e.repo)!.at)) signals.set(e.repo, e)
  const ranked = signals.size ? rankOpportunities(input.repos, entries, [...signals.values()], now, { blockOnStalePrs: true }) : []
  const stale = [...signals.values()].filter(s => s.botPrs?.stale.length)

  const sections: RoleSection[] = []

  // ── PM: what goes to the Architect next ─────────────────────────────────────
  const inTarget = openPrs.length >= input.prTarget.min
  sections.push({
    id: 'pm', role: 'Product Manager', skill: '/office-hours · /plan-ceo-review', title: 'Plan handed to the Architect',
    lines: [
      `${plural(openPrs.length, 'PR')} waiting for your review (target ${input.prTarget.min}–${input.prTarget.max})${inTarget ? '' : ' — below target'}.`,
      todo.length === 0
        ? 'Backlog is empty: every scanned repo is green or already has a PR open. Next lever: add repos to the allowlist.'
        : `Next up (${plural(todo.length, 'task')}, highest value first):`,
      ...todo.slice(0, 8).map((t, i) => `${i + 1}. ${short(t.repo)} — ${KIND_LABEL[t.kind] ?? t.kind}`),
      ...(todo.length > 8 ? [`…and ${todo.length - 8} more.`] : []),
      ...(ranked.length ? [`Repo queue for the next cycle: ${ranked.filter(o => !o.blocked).slice(0, 5).map(o => `${short(o.repo)}${o.reasons[0] ? ` (${o.reasons[0]})` : ''}`).join(' → ')}.`] : []),
      ...stale.map(s => `${short(s.repo)}: ${plural(s.botPrs!.stale.length, 'bot PR')} unreviewed for 7+ days — no new factory PRs there until you review or close ${s.botPrs!.stale.length === 1 ? 'it' : 'them'}: ${s.botPrs!.stale.map(p => p.url).join(' ')}`),
    ],
  })

  // ── Architect: routing + model pool ─────────────────────────────────────────
  const tiers: ModelTier[] = ['M0', 'M1', 'MC', 'M2']
  const tierLine = (t: ModelTier) => {
    const as = last7.filter(a => a.tier === t && a.outcome !== 'rate_limited' && a.harness !== 'npm-audit-fix' && a.harness !== 'lint-autofix')
    const v = as.filter(a => a.outcome === 'verified').length
    return as.length ? `${t}: ${v}/${as.length} verified` : null
  }
  const poolLine = ['free-agent', 'free-agent-b', 'free-agent-c'].map(a => input.pool[a]).filter(Boolean).join(' → ')
  const escalations = last24.filter(a => a.outcome === 'failed').length
  sections.push({
    id: 'architect', role: 'Architect', skill: '/plan-eng-review', title: 'Routing and model decisions',
    lines: [
      `Tier results, last 7 days: ${tiers.map(tierLine).filter(Boolean).join(' · ') || 'no attempts yet'}.`,
      `Free pool (in fallback order): ${poolLine || 'not configured'}.`,
      `Copilot builder: ${input.copilot.enabled ? `${input.copilot.model}, ${input.copilot.tasksToday}/${input.copilot.maxTasksPerDay} tasks today` : 'disabled'}.`,
      `${plural(escalations, 'failed attempt')} in the last 24h (each one escalated to the next tier or was recorded as a dead end).`,
    ],
  })

  // ── Builder: what shipped ───────────────────────────────────────────────────
  const held = last24.filter(a => a.reported && a.outcome === 'verified')
  sections.push({
    id: 'builder', role: 'Builder', skill: '/ship', title: 'Draft PRs opened (last 24h)',
    lines: [...(newPrs.length === 0
      ? ['No new PRs in the last 24 hours.']
      : newPrs.map(a => {
        const state = resolutions.get(a.id)?.outcome
        const tag = state === 'merged' ? ' (merged)' : state === 'rejected' ? ' (closed)' : ''
        const flag = a.adversary && a.adversary.verdict !== 'PASS' ? ` [reviewer: ${a.adversary.verdict}]` : ''
        return `${short(a.repo)}: ${KIND_LABEL[a.kind] ?? a.kind}${tag}${flag} — ${a.tier} · ${a.harness === 'npm-audit-fix' ? 'npm audit fix' : a.harness === 'lint-autofix' ? 'lint autofix' : a.model} · ${Math.round(a.durationMs / 60000)} min — ${a.prUrl}`
      })),
    ...(held.length ? [`Held back (capability at stage "report", verified, no PR): ${held.map(a => `${short(a.repo)} ${a.kind}`).join(', ')} — patches in ~/.repohq-factory/logs/${held[0].runId}/.`] : []),
    ],
  })

  // ── QA: checks + judge ──────────────────────────────────────────────────────
  const mark = (v: boolean | null | undefined) => (v === undefined ? '–' : v ? '✓' : '✗')
  const rejections = last24.filter(a => a.outcome === 'failed')
  sections.push({
    id: 'qa', role: 'QA Lead', skill: '/qa', title: 'Checks and verification',
    lines: [
      'Latest scan per repo (typecheck / lint / test):',
      ...scans.map(s => `${short(s.repo)}: ${s.checks.install === false ? 'install failed' : `${mark(s.checks.typecheck)} ${mark(s.checks.lint)} ${mark(s.checks.test)}`}`),
      ...scans.filter(s => s.envFailures?.length).map(s => `${short(s.repo)}: the ${s.envFailures!.join(' and ')} check${s.envFailures!.length > 1 ? 's need' : ' needs'} secrets or network the factory doesn't have — not a code task; run it in CI with keys.`),
      rejections.length === 0 ? 'Judge rejected nothing in the last 24h.' : `Judge rejected ${plural(rejections.length, 'attempt')}:`,
      ...rejections.slice(0, 6).map(a => `${short(a.repo)} ${a.kind} (${a.tier}): ${a.reason}`),
    ],
  })

  // ── Reviewer: Copilot code review ───────────────────────────────────────────
  const reviewed = openPrs.filter(a => reviews.has(a.id))
  const waiting = openPrs.filter(a => a.reviewRequested && !reviews.has(a.id))
  sections.push({
    id: 'reviewer', role: 'Reviewer', skill: '/review (GitHub Copilot code review)', title: 'Independent review of open PRs',
    lines: [
      `${reviewed.length} reviewed by Copilot, ${waiting.length} waiting, ${openPrs.length - reviewed.length - waiting.length} not requested.`,
      ...reviewed.map(a => {
        const r = reviews.get(a.id)!
        return `${short(a.repo)} ${a.kind}: ${r.comments === 0 ? 'no line comments' : plural(r.comments, 'line comment')} — ${a.prUrl}`
      }),
      `Copilot reviews today: ${input.copilot.reviewsToday}/${input.copilot.maxReviewsPerDay}.`,
    ],
  })

  // ── Security ────────────────────────────────────────────────────────────────
  const audited = scans.filter(s => s.audit)
  const risky = audited.filter(s => (s.audit!.critical + s.audit!.high) > 0)
  const alertSignals = [...signals.values()]
  const disabled = alertSignals.filter(s => s.alerts.status === 'disabled')
  const alerting = alertSignals.filter(s => s.alerts.status === 'ok' && s.alerts.critical + s.alerts.high > 0)
  sections.push({
    id: 'security', role: 'Security Officer', skill: '/cso', title: 'Dependencies and data policy',
    lines: [
      audited.length === 0
        ? 'No npm audits recorded yet (runs on the next scan of each npm repo).'
        : `${risky.length} of ${audited.length} audited repos have high/critical advisories:`,
      ...risky.map(s => `${short(s.repo)}: ${s.audit!.critical} critical, ${s.audit!.high} high, ${s.audit!.moderate} moderate`),
      ...alerting.map(s => `${short(s.repo)}: Dependabot ${s.alerts.critical} critical, ${s.alerts.high} high open (${s.alerts.npmFixable} npm-fixable)`),
      ...(disabled.length ? [`Dependabot alerts are disabled on ${disabled.length} of ${alertSignals.length} repos (${disabled.map(s => short(s.repo)).join(', ')}): enable them in each repo's Settings → Code security so this sensor has data.`] : []),
      'Policy in force: private repos never go to free-cloud models; the factory never merges, force-pushes or deletes.',
    ],
  })

  // ── Ops ─────────────────────────────────────────────────────────────────────
  const failedCycles = input.cycles.filter(c => c.exit !== 0)
  const red = [...signals.values()].filter(s => s.redCi?.length)
  const investigations = new Map<string, AttemptEntry>()
  for (const a of attempts.filter(x => x.kind === 'red-ci' && x.findings)) if (!investigations.get(a.repo) || a.at > investigations.get(a.repo)!.at) investigations.set(a.repo, a)
  const oracles = entries.filter((e): e is CiOracleEntry => e.type === 'ci_oracle' && since(e.at, now, 7 * DAY))
  const health = input.systemHealth ? systemHealthLines(input.systemHealth, now) : null
  sections.push({
    id: 'ops', role: 'Ops / SRE', skill: '/canary', title: 'Stack health and budgets',
    lines: [
      ...(health?.lines ?? []),
      `LiteLLM gateway: ${input.liteLLMUp ? 'up' : 'DOWN'}.`,
      `Cycles in the last 24h: ${input.cycles.length}${failedCycles.length ? ` (${failedCycles.length} failed)` : ''}.`,
      `OpenRouter free quota: ${input.openRouterQuota ? `${input.openRouterQuota.remaining}/${input.openRouterQuota.limit} left today` : 'unknown'} (one pool member of three).`,
      ...(input.copilot.quota
        ? [input.copilot.quota.percentRemaining > 0
          ? `Copilot premium requests: ${Math.round(input.copilot.quota.percentRemaining)}% left this month.`
          : `Copilot premium requests used up — builder and reviews paused until ${input.copilot.quota.resetDate ?? 'the monthly reset'}.`]
        : []),
      `Paid spend this month: $${input.monthToDateUsd.toFixed(2)} of $${input.monthlyBudgetUsd} budget (scheduled cycles always run at $0).`,
      readinessLine(nightShiftReadiness(entries)),
      red.length ? `Red CI on ${plural(red.length, 'base branch')}:` : 'CI is green on every sensed base branch.',
      ...red.map(s => {
        const inv = investigations.get(s.repo)
        const cause = inv?.findings?.split('\n').slice(1).find(l => l.trim() && !l.startsWith('#'))?.trim()
        return `${short(s.repo)} (${s.base}): ${s.redCi!.map(r => r.workflow).join(', ')}${cause ? ` — root cause: ${cause.slice(0, 200)}` : ''}`
      }),
      ...oracles.map(o => `red-ci PR: "${o.workflow}" ${o.passed ? 'passes' : 'still fails'} on the PR.`),
    ],
  })

  // ── Retro ───────────────────────────────────────────────────────────────────
  const counted = last7.filter(a => a.outcome !== 'rate_limited')
  const verified = counted.filter(a => a.outcome === 'verified')
  const merged = counted.filter(a => resolutions.get(a.id)?.outcome === 'merged')
  const rejected = counted.filter(a => resolutions.get(a.id)?.outcome === 'rejected')
  const paid = verified.filter(a => a.tier === 'M2').length
  const kpis = computeFactoryKpis(toJobRecords(entries), now, { approvalsNeeded: entries.filter(e => e.type === 'approval_needed' && since(e.at, now, 30 * DAY)).length })
  sections.push({
    id: 'retro', role: 'Engineering Manager', skill: '/retro', title: 'Last 7 days',
    lines: [
      `${kpiHeadline(kpis)} (30 days).`,
      ...(() => {
        const t = kpiTrend(toJobRecords(entries), now)
        return t.direction ? [`Trend (last 15 nights vs the 15 before): ${t.direction} — yield ${t.previous.overnightYield?.toFixed(1)} → ${t.recent.overnightYield?.toFixed(1)}/night.`] : []
      })(),
      ...(kpis.reviewHoursMedian !== null ? [`Review load: median ${kpis.reviewHoursMedian.toFixed(1)}h from PR to your decision; ${kpis.humanEditedPrs} merged PR(s) needed your edits.`] : []),
      `${plural(counted.length, 'attempt')}, ${verified.length} verified, ${merged.length} merged, ${rejected.length} closed without merging.`,
      verified.length ? `${Math.round(((verified.length - paid) / verified.length) * 100)}% of verified fixes cost $0 at the margin.` : 'No verified fixes yet this week.',
      merged.length + rejected.length > 0
        ? `Merge rate: ${Math.round((merged.length / (merged.length + rejected.length)) * 100)}% — every merge or close trains the router.`
        : 'Merge or close the open PRs: that is how the router learns which tier to trust.',
    ],
  })

  // ── Director: promotion ladder ──────────────────────────────────────────────
  if (input.capabilities) {
    const status = ladderStatus(input.capabilities, entries, now)
    const ready = status.filter(c => c.advice !== 'hold')
    sections.push({
      id: 'ladder', role: 'Director', skill: 'promotion ladder', title: 'What each capability may do (observe → report → pr)',
      lines: [
        ...(ready.length ? ready.map(c => `${c.advice === 'promote' ? '⬆' : '⬇'} ${c.capability} (${c.stage}): ${c.next}.`) : ['No promotions or demotions suggested.']),
        ...status.map(c => `${c.capability}: ${c.stage} — ${c.evidence}${c.advice === 'hold' ? `; ${c.next}` : ''}.`),
        'Stages change only when you edit "capabilities" in factory/factory.config.json.',
      ],
    })
  }

  for (const s of sections) {
    const h = input.headlines?.[s.id]
    if (h) s.lines.unshift(`“${h}”`)
  }

  const day = now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
  const subject = `${health?.alarm ? '⚠ ' : ''}RepoHQ factory · ${day} · ${plural(openPrs.length, 'PR')} to review · ${plural(kpis.lastNightPrs, 'new PR')} last night`
  return { subject, sections, text: renderText(subject, sections), html: renderHtml(subject, sections) }
}

function renderText(subject: string, sections: RoleSection[]): string {
  return [subject, '', ...sections.flatMap(s => [`${s.role.toUpperCase()} (${s.skill}) — ${s.title}`, ...s.lines.map(l => `  ${l}`), ''])].join('\n')
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const linkify = (s: string) => esc(s).replace(/https:\/\/github\.com\/\S+\/pull\/\d+/g, u => `<a href="${u}">${u.replace('https://github.com/', '')}</a>`)

function renderHtml(subject: string, sections: RoleSection[]): string {
  const body = sections.map(s => `
    <tr><td style="padding:16px 0 4px;border-top:1px solid #e5e7eb">
      <div style="font:600 15px system-ui,sans-serif;color:#111827">${esc(s.role)} <span style="font-weight:400;color:#6b7280">· ${esc(s.skill)}</span></div>
      <div style="font:13px system-ui,sans-serif;color:#4b5563;margin:2px 0 6px">${esc(s.title)}</div>
      ${s.lines.map(l => `<div style="font:14px/1.5 system-ui,sans-serif;color:#1f2937">${linkify(l)}</div>`).join('')}
    </td></tr>`).join('')
  return `<!doctype html><html><body style="margin:0;background:#f9fafb"><table role="presentation" style="max-width:640px;margin:0 auto;padding:24px;background:#fff">
    <tr><td><div style="font:700 18px system-ui,sans-serif;color:#111827">${esc(subject)}</div>
    <div style="font:13px system-ui,sans-serif;color:#6b7280">One update per role, from the factory's own records.</div></td></tr>${body}
  </table></body></html>`
}

/** RFC 5322 multipart/alternative message for `himalaya message send`. */
export function toMime(report: MorningReport, from: string, to: string, now: Date): string {
  const boundary = `repohq-${now.getTime().toString(36)}`
  const subject = /^[\x20-\x7e]*$/.test(report.subject) ? report.subject : `=?UTF-8?B?${Buffer.from(report.subject).toString('base64')}?=`
  const b64 = (s: string) => Buffer.from(s).toString('base64').replace(/.{76}/g, '$&\r\n')
  return [
    `From: RepoHQ Factory <${from}>`, `To: ${to}`, `Subject: ${subject}`, `Date: ${now.toUTCString()}`,
    'MIME-Version: 1.0', `Content-Type: multipart/alternative; boundary="${boundary}"`, '',
    `--${boundary}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64(report.text),
    `--${boundary}`, 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', b64(report.html),
    `--${boundary}--`, '',
  ].join('\r\n')
}
