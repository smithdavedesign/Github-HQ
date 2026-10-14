/**
 * Settings → Keys data: the latest `~/ai-stack/bin/secrets sync` (table secret_inventory), grouped by platform.
 * Names and places only: the table never holds a value. `groupInventory` is pure and tested.
 */
import { PLATFORMS, platformKey, rotationWarning, type Platform } from './platforms'

export type SecretPlace = {
  path: string
  field: string
  kind: string
  line?: number | null
  repo?: string | null
  tracked: boolean
  everCommitted: boolean
  note?: string | null
}
export type SecretEntry = {
  id: string
  name: string
  platform: string
  keychain: string[]
  places: SecretPlace[]
  /** Recorded dead (`bin/secrets revoked`): copies left in git history or backups are harmless. */
  revoked?: boolean
}
/** A macOS protection or exposure check from the scan (`ok` null: for information). */
export type HostCheck = { name: string; ok: boolean | null; detail: string }
export type CloudInventory = {
  vercel?: { projects?: { project: string; envs: { name: string; targets: string[] }[] }[]; error?: string }
  github?: { repos?: { repo: string; private?: boolean; secrets: string[]; dependabot: string[]; leakAlerts?: { type: string; url: string; createdAt?: string }[] }[]; checked?: number; error?: string }
  gcp?: { project?: string; keys?: { name: string; created?: string; apis?: string[] }[]; error?: string }
  neon?: { projects?: { name: string; id: string }[]; error?: string }
}
export type InventoryRow = {
  host: string
  takenAt: Date
  entries: SecretEntry[]
  cloud: CloudInventory
  keychain: string[]
  blocked: { path: string; error: string }[]
  hostChecks?: HostCheck[] | null
}

export type KeyView = SecretEntry & {
  warning: string | null
  /** Vercel projects and GitHub repos that hold a secret with the same name (a likely copy in the cloud). */
  cloud: string[]
  problems: string[]
}
export type PlatformGroup = { platform: Platform; keys: KeyView[] }
export type Alert = { severity: 'high' | 'medium'; text: string; href?: string }

const LOCAL_ONLY = new Set(['litellm', 'minio', 'openclaw', 'whatsapp', 'ssh'])

/** OpenClaw keeps its own rotating, owner-only config backups (`bin/secrets check` accepts them too). */
const MANAGED_BACKUP = /\/\.openclaw\/.*\.bak(\.\d)?$/
const strayBackup = (p: SecretPlace) => p.kind === 'backup-file' && !MANAGED_BACKUP.test(p.path)

/** What's wrong with one key, worst first. A revoked key has nothing left to fix. */
function problemsOf(e: SecretEntry): string[] {
  if (e.revoked) return []
  const out: string[] = []
  for (const p of e.places) {
    if (p.tracked) out.push(`committed to git: ${p.path}`)
    else if (p.everCommitted) out.push(`in git history: ${p.path}`)
  }
  if (e.places.some(p => p.kind === 'launchagent-args')) out.push('on a command line (readable with ps)')
  const traces = e.places.filter(p => p.kind === 'trace').length
  if (traces) out.push(`${traces} cop${traces === 1 ? 'y' : 'ies'} left in logs or transcripts (bin/secrets scrub)`)
  const real = e.places.filter(p => p.kind !== 'trace')
  if (e.keychain.length === 0 && real.length && !real.every(p => ['private-key-file', 'credential-file', 'cli-login'].includes(p.kind))) out.push('no keychain copy yet')
  const backups = e.places.filter(strayBackup).length
  if (backups) out.push(`${backups} backup file${backups === 1 ? ' holds' : 's hold'} a copy`)
  return [...new Set(out)]
}

const weight = (problems: string[]) => problems.reduce((n, p) => n + (/^committed|^in git/.test(p) ? 100 : /command line|logs or transcripts/.test(p) ? 10 : /no keychain/.test(p) ? 5 : 1), 0)

export function groupInventory(row: Pick<InventoryRow, 'entries' | 'cloud'>): { groups: PlatformGroup[]; alerts: Alert[] } {
  const vercelByName = new Map<string, string[]>()
  for (const p of row.cloud.vercel?.projects ?? []) for (const e of p.envs) vercelByName.set(e.name, [...(vercelByName.get(e.name) ?? []), `Vercel: ${p.project}`])
  const ghByName = new Map<string, string[]>()
  for (const r of row.cloud.github?.repos ?? []) for (const s of [...r.secrets, ...r.dependabot]) ghByName.set(s, [...(ghByName.get(s) ?? []), `GitHub Actions: ${r.repo}`])

  const byPlatform = new Map<string, KeyView[]>()
  for (const e of row.entries) {
    const key = platformKey(e.name, e.platform)
    const names = new Set(e.places.map(p => p.field.split('.').pop() ?? p.field).concat(e.name))
    const cloud = LOCAL_ONLY.has(key) ? [] : [...new Set([...names].flatMap(n => [...(vercelByName.get(n) ?? []), ...(ghByName.get(n) ?? [])]))].sort()
    byPlatform.set(key, [...(byPlatform.get(key) ?? []), { ...e, warning: rotationWarning(e.name), cloud, problems: problemsOf(e) }])
  }
  const groups = [...byPlatform.entries()]
    .map(([key, keys]) => ({ platform: PLATFORMS[key] ?? PLATFORMS.other!, keys: keys.sort((a, b) => weight(b.problems) - weight(a.problems) || a.name.localeCompare(b.name)) }))
    .sort((a, b) => (a.platform.key === 'other' ? 1 : 0) - (b.platform.key === 'other' ? 1 : 0)
      || Math.max(0, ...b.keys.map(k => weight(k.problems))) - Math.max(0, ...a.keys.map(k => weight(k.problems)))
      || a.platform.label.localeCompare(b.platform.label))

  const alerts: Alert[] = []
  for (const e of row.entries) {
    if (e.revoked) continue
    for (const p of e.places) {
      if (p.tracked) alerts.push({ severity: 'high', text: `${e.name} is committed to git in ${p.repo ?? p.path}: rotate it, then stop tracking the file.` })
      if (p.kind === 'launchagent-args') alerts.push({ severity: 'medium', text: `A key sits on the command line of ${p.path.split('/').pop()}: any process can read it with ps.` })
    }
    const traces = e.places.filter(p => p.kind === 'trace').length
    if (traces) alerts.push({ severity: 'medium', text: `${e.name} has ${traces} cop${traces === 1 ? 'y' : 'ies'} in logs or transcripts: run ~/ai-stack/bin/secrets scrub, and rotate it if the copy reached a model.` })
  }
  for (const r of row.cloud.github?.repos ?? []) for (const a of r.leakAlerts ?? []) {
    alerts.push({ severity: 'high', text: `GitHub found a leaked ${a.type} in ${r.repo}${r.private === false ? ' (public repo)' : ''}.`, href: a.url })
  }
  const backups = [...new Set(row.entries.flatMap(e => e.places.filter(strayBackup).map(p => p.path)))]
  if (backups.length) alerts.push({ severity: 'medium', text: `${backups.length} backup file${backups.length === 1 ? ' holds' : 's hold'} copies of keys (${backups.join(', ')}): delete them once you've checked nothing needs them.` })
  return { groups, alerts: alerts.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'high' ? -1 : 1)) }
}
