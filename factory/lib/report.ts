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
import { STALE_PR_DAYS, rankOpportunities } from './sensors'
import { computeFactoryKpis, kpiHeadline } from '../../src/lib/agents/factory-kpis'
import { latestSignals, toJobRecords } from './ledger'
import { kpiTrend, nightShiftReadiness, readinessLine } from './night-shift'
import { preflightLines, type PreflightCheck } from './preflight'
import { AGING_PR_DAYS, PR_SOURCE_LABEL, prAgeDays, prSource, sortForReview, type OpenPr } from '../../src/lib/agents/open-prs'
import { prValueFromLabels } from '../../src/lib/agents/pr-value'
import { nextActionLines, type NextActions } from '../../src/lib/portfolio/next-actions'

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
  /** Every open PR across the owner's repos (`gh search prs`); null = the search failed, absent = not gathered. */
  openPrsAll?: OpenPr[] | null
  /** The owner's GitHub login, to tell their own PRs from contributors'. */
  ownerLogin?: string | null
  /** "What should I do next?" from RepoHQ's repo data (src/lib/portfolio/next-actions.ts). */
  nextActions?: NextActions | null
  /** What the night shift depends on, checked at report time (factory/lib/preflight.ts). */
  preflight?: PreflightCheck[]
}

export type RoleId = 'inbox' | 'next' | 'pm' | 'architect' | 'builder' | 'qa' | 'reviewer' | 'security' | 'ops' | 'retro' | 'ladder'

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
  const signals = latestSignals(entries)
  return latestScans(entries, repos)
    // Requests are listed with their outcomes, not as sensed work (an old scan kept showing them).
    .flatMap(s => s.tasks.filter(k => k !== 'owner-requested' && k !== 'owner-report').map(kind => ({ repo: s.repo, kind })))
    .filter(t => !openKinds.has(`${t.repo}:${t.kind}`))
    // A scan's red CI is stale once newer signals show the base branch green (ai-brand-context,
    // 2026-10-10: a scan from two days earlier kept "fix red CI" at the top of the list).
    .filter(t => t.kind !== 'red-ci' || !signals.has(t.repo) || (signals.get(t.repo)!.redCi?.length ?? 0) > 0)
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
  const ranked = signals.size ? rankOpportunities(input.repos, entries, [...signals.values()], now, { blockOnStalePrs: true, redCiReportOnly: input.capabilities?.['red-ci'] === 'report' }) : []
  const stale = [...signals.values()].filter(s => s.botPrs?.stale.length)

  const sections: RoleSection[] = []

  // ── Inbox: every open PR waiting for you, so none get lost ──────────────────
  if (input.openPrsAll !== undefined) {
    sections.push({ id: 'inbox', role: 'Your review queue', skill: 'open PRs across your repos', title: 'Waiting for you, oldest first', lines: inboxLines(input.openPrsAll, attempts, reviews, now, input.ownerLogin) })
  }

  // ── Next: what deserves your attention, and why ─────────────────────────────
  if (input.nextActions) {
    sections.push({ id: 'next', role: 'Chief of Staff', skill: 'RepoHQ decision states', title: 'What to do next', lines: nextActionLines(input.nextActions) })
  }

  // ── PM: what goes to the Architect next ─────────────────────────────────────
  const inTarget = openPrs.length >= input.prTarget.min
  sections.push({
    id: 'pm', role: 'Product Manager', skill: '/office-hours · /plan-ceo-review', title: 'Plan handed to the Architect',
    lines: [
      `${plural(openPrs.length, 'factory PR')} open (overnight target ${input.prTarget.min}–${input.prTarget.max})${inTarget ? '' : ' — below target'}.`,
      todo.length === 0
        ? 'Backlog is empty: every scanned repo is green or already has a PR open. Next lever: add repos to the allowlist.'
        : `Next up (${plural(todo.length, 'task')}, highest value first):`,
      ...todo.slice(0, 8).map((t, i) => `${i + 1}. ${short(t.repo)} — ${t.kind === 'red-ci' && input.capabilities?.['red-ci'] !== 'pr' ? 'investigate red CI (report only, no PR)' : KIND_LABEL[t.kind] ?? t.kind}`),
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
      `Copilot builder: ${!input.copilot.enabled ? 'disabled'
        : input.copilot.quota?.percentRemaining === 0 ? `paused until ${input.copilot.quota.resetDate ?? 'the monthly reset'} (premium requests used up)`
        : `${input.copilot.model}, ${input.copilot.tasksToday}/${input.copilot.maxTasksPerDay} tasks today`}.`,
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

  // ── Reviewer: Copilot code review, or the local stack's gstack /review when Copilot can't ─────
  const reviewed = openPrs.filter(a => reviews.has(a.id))
  const byLocal = reviewed.filter(a => reviews.get(a.id)!.reviewer === 'local').length
  const waiting = openPrs.filter(a => a.reviewRequested && !reviews.has(a.id))
  sections.push({
    id: 'reviewer', role: 'Reviewer', skill: '/review (GitHub Copilot code review; gstack /review on the local stack as fallback)', title: 'Independent review of open PRs',
    lines: [
      `${reviewed.length - byLocal} reviewed by Copilot, ${byLocal} by the local reviewer, ${waiting.length} waiting, ${openPrs.length - reviewed.length - waiting.length} not reviewed.`,
      ...reviewed.map(a => {
        const r = reviews.get(a.id)!
        const what = r.reviewer === 'local'
          ? (r.comments === 0 ? 'local review: no findings' : `local review: ${plural(r.comments, 'finding')}`)
          : (r.comments === 0 ? 'no line comments' : plural(r.comments, 'line comment'))
        return `${short(a.repo)} ${a.kind}: ${what} — ${a.prUrl}`
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
  const pre = preflightLines(input.preflight ?? [])
  sections.push({
    id: 'ops', role: 'Ops / SRE', skill: '/canary', title: 'Stack health and budgets',
    lines: [
      ...pre.lines,
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
      red.length ? `Red CI on ${red.length === 1 ? '1 base branch' : `${red.length} base branches`}:` : 'CI is green on every sensed base branch.',
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
      kpis.ratedPrs > 0
        ? `PR value (scored from outcomes on main): ${kpis.avgValue!.toFixed(1)}/5 over ${plural(kpis.ratedPrs, 'merged PR')}; ${kpis.usefulPrs} useful (value ≥ 2)${kpis.usefulPerNight !== null ? `, ${kpis.usefulPerNight.toFixed(2)} useful PRs/night` : ''}.`
        : 'PR value: none scored yet — merged PRs are scored from their outcome on main a day after merging (a value:N label overrides).',
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
  const toReview = input.openPrsAll ? input.openPrsAll.length : openPrs.length
  const subject = `${health?.alarm || pre.alarm ? '⚠ ' : ''}RepoHQ factory · ${day} · ${plural(toReview, 'PR')} to review · ${plural(kpis.lastNightPrs, 'new PR')} last night`
  return { subject, sections, text: renderText(subject, sections), html: renderHtml(subject, sections) }
}

/** One line per open PR, oldest first; factory PRs carry what they fix and the reviewer's verdict. */
export function inboxLines(
  prs: OpenPr[] | null, attempts: AttemptEntry[], reviews: Map<string, ReviewEntry>, now: Date, ownerLogin?: string | null,
): string[] {
  if (prs === null) return ['Could not list open PRs (gh search failed) — check `gh auth status`.']
  if (prs.length === 0) return ['No open PRs anywhere. Inbox zero.']
  const byUrl = new Map(attempts.filter(a => a.prUrl).map(a => [a.prUrl!, a]))
  const sorted = sortForReview(prs)
  const aging = sorted.filter(p => prAgeDays(p, now) >= AGING_PR_DAYS).length
  const lines = sorted.slice(0, 25).map(p => {
    const a = byUrl.get(p.url)
    const src = prSource(p, { ownerLogin, factoryUrls: new Set(byUrl.keys()) })
    const age = prAgeDays(p, now)
    const r = a ? reviews.get(a.id) : undefined
    const what = a ? `${KIND_LABEL[a.kind] ?? a.kind} (${a.tier})` : p.title.slice(0, 80)
    const notes = [
      ...(a?.adversary && a.adversary.verdict !== 'PASS' ? [`reviewer: ${a.adversary.verdict}`] : []),
      ...(r ? [r.comments === 0 ? 'review clean' : plural(r.comments, 'review comment')] : []),
      ...(p.isDraft ? ['draft'] : []),
      // An unreviewed bot PR blocks new factory work on its repo after STALE_PR_DAYS (blockOnStaleBotPrs).
      ...(src === 'factory' && age >= STALE_PR_DAYS ? ['repo paused for new factory PRs until this is merged or closed'] : []),
      ...(src === 'factory' && age >= STALE_PR_DAYS - 2 && age < STALE_PR_DAYS ? [`repo pauses for new factory PRs in ${STALE_PR_DAYS - age}d`] : []),
      ...(prValueFromLabels(p.labels) !== null ? [`value:${prValueFromLabels(p.labels)}`] : []),
    ]
    return `${age >= AGING_PR_DAYS ? '⚠ ' : ''}${short(p.repo)}#${p.number} · ${age}d · ${PR_SOURCE_LABEL[src]} · ${what}${notes.length ? ` [${notes.join(', ')}]` : ''} — ${p.url}`
  })
  return [
    `${plural(prs.length, 'open PR')}${aging ? `, ${aging} open ${AGING_PR_DAYS}+ days (⚠)` : ''}. Merge or close each.`,
    ...lines,
    ...(prs.length > 25 ? [`…and ${prs.length - 25} more.`] : []),
  ]
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

/**
 * A cycle's log file: `cycle-20261006-160505.log` from the launchd calendar, or
 * `cycle-20261007T050500-bfaceaca.log` from the Agent HQ worker (Phase 81).
 */
export function isCycleLog(fileName: string): boolean {
  return /^cycle-(\d{8}-\d{6}|\d{8}T\d{6}-[0-9a-f]{8})\.log$/.test(fileName)
}

/** Start and exit code from a cycle log; the worker's header adds ` run <id>` before the closing `===`. */
export function cycleLogEntry(text: string): { at: string; exit: number | null } | null {
  const at = /=== cycle (\S+)(?: run \S+)? ===/.exec(text)?.[1]
  if (!at || Number.isNaN(Date.parse(at))) return null
  const exit = /=== exit (\d+) ===/.exec(text)?.[1]
  return { at, exit: exit === undefined ? null : Number(exit) }
}

/** Why a `himalaya message send` failed, never empty: a timeout or a silent exit used to log nothing. */
export function emailFailureReason(r: { code: number | null; output: string; timedOut: boolean }): string {
  if (r.timedOut) return 'no answer from Gmail within 60 s (no network?)'
  const tail = r.output.trim().split('\n').map(l => l.trim()).filter(Boolean).slice(-2).join(' | ')
  return tail || `himalaya exited ${r.code ?? 'without a code'} with no output`
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
