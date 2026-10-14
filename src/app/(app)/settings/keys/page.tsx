import { auth } from '@/lib/auth'
import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { db } from '@/lib/db'
import { secretInventory } from '@/lib/db/schema'
import { desc } from 'drizzle-orm'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CopyButton } from '@/components/ideas/copy-button'
import { formatDistanceToNow } from '@/lib/utils'
import { AlertTriangle, CheckCircle2, ChevronLeft, ExternalLink, KeyRound, Laptop, Lock, XCircle } from 'lucide-react'
import { groupInventory, type CloudInventory, type HostCheck, type SecretEntry } from '@/lib/secrets/inventory'
import { keychainCommand } from '@/lib/secrets/platforms'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Keys' }

/**
 * Every secret the owner's system uses: where to rotate it, where it's used, and the keychain item that holds it.
 * Fed by `~/ai-stack/bin/secrets scan && bin/secrets sync` (names and places only, never values). Owner only.
 */
export default async function KeysPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')
  if (process.env.FACTORY_USER_ID !== session.user.id) notFound()

  const row = await db.select().from(secretInventory).orderBy(desc(secretInventory.takenAt)).limit(1).then(r => r[0])

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <Link href="/settings" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ChevronLeft className="w-3 h-3" />Settings</Link>
        <h1 className="text-2xl font-bold tracking-tight mt-1">Keys</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Every key your system uses, where to rotate it, and where it lives on your Mac. Names only: values never leave the keychain.
        </p>
      </div>
      {!row ? <Empty /> : <Inventory row={{ ...row, entries: row.entries as SecretEntry[], cloud: row.cloud as CloudInventory, keychain: row.keychain as string[], blocked: row.blocked as { path: string; error: string }[], hostChecks: (row.hostChecks as HostCheck[] | null) ?? [] }} />}
    </div>
  )
}

function Empty() {
  return (
    <Card>
      <CardContent className="py-8 text-sm text-muted-foreground space-y-2">
        <p>No scan yet. On your Mac:</p>
        <pre className="rounded bg-muted px-3 py-2 text-xs">~/ai-stack/bin/secrets scan && ~/ai-stack/bin/secrets sync</pre>
      </CardContent>
    </Card>
  )
}

function Inventory({ row }: { row: { host: string; takenAt: Date; entries: SecretEntry[]; cloud: CloudInventory; keychain: string[]; blocked: { path: string; error: string }[]; hostChecks: HostCheck[] } }) {
  const { groups, alerts } = groupInventory(row)
  const held = row.entries.filter(e => e.keychain.length > 0).length
  const places = row.entries.reduce((n, e) => n + e.places.length, 0)
  const vercel = row.cloud.vercel?.projects ?? []
  const github = row.cloud.github?.repos ?? []

  return (
    <>
      <div className="grid grid-cols-3 gap-3 text-center">
        <Stat value={row.entries.length} label="distinct keys" />
        <Stat value={places} label="copies on this Mac" />
        <Stat value={`${held}/${row.entries.length}`} label="in the keychain" />
      </div>
      <p className="text-xs text-muted-foreground">
        Scanned {formatDistanceToNow(row.takenAt)} on {row.host}. Refresh: <code>~/ai-stack/bin/secrets scan && ~/ai-stack/bin/secrets sync</code>
      </p>

      {row.hostChecks.length > 0 && (
        <Card data-testid="host-checks">
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><Laptop className="w-4 h-4" />This Mac</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm">
              {row.hostChecks.map(c => (
                <li key={c.name} className="flex items-start gap-2">
                  {c.ok === false ? <XCircle className="w-4 h-4 mt-0.5 shrink-0 text-amber-500" /> : <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-emerald-600" />}
                  <span><span className="font-medium">{c.name}</span> <span className="text-muted-foreground break-words">— {c.detail}</span></span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {alerts.length > 0 && (
        <Card className="border-amber-500/40">
          <CardHeader className="pb-2"><CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-amber-500" />Fix first</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm" data-testid="key-alerts">
              {alerts.map((a, i) => (
                <li key={i} className="flex gap-2">
                  <Badge variant={a.severity === 'high' ? 'destructive' : 'secondary'} className="shrink-0">{a.severity === 'high' ? 'urgent' : 'soon'}</Badge>
                  <span>{a.text}{a.href && <> <a href={a.href} target="_blank" rel="noreferrer" className="underline">Open</a></>}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {groups.map(({ platform, keys }) => (
        <Card key={platform.key} data-testid={`key-platform-${platform.key}`}>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base flex items-center gap-2"><KeyRound className="w-4 h-4" />{platform.label}<span className="text-xs font-normal text-muted-foreground">{keys.length}</span></CardTitle>
              {platform.rotateUrl && (
                <a href={platform.rotateUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1 text-xs font-medium hover:bg-muted">
                  Rotate <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{platform.how}</p>
          </CardHeader>
          <CardContent className="space-y-3">
            {keys.map(k => (
              <div key={k.id} className="rounded-lg border p-3 space-y-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="font-semibold break-all">{k.name}</code>
                  {k.revoked ? <Badge variant="outline" className="text-muted-foreground" title="Recorded dead: leftover copies are harmless">revoked</Badge>
                    : k.problems.length === 0 && <Badge variant="outline" className="text-emerald-600 border-emerald-600/40">ok</Badge>}
                  {k.problems.map(p => <span key={p} className={`rounded-md px-1.5 py-0.5 text-xs break-all ${/^committed|^in git/.test(p) ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'}`}>{p}</span>)}
                </div>
                {k.warning && <p className="text-xs text-amber-600 dark:text-amber-400">{k.warning}</p>}
                {k.keychain.map(svc => (
                  <div key={svc} className="flex flex-wrap items-center gap-2 text-xs">
                    <Lock className="w-3 h-3 text-muted-foreground" />
                    <span className="text-muted-foreground">Keychain</span>
                    <code className="break-all">{svc}</code>
                    <CopyButton text={keychainCommand(svc)} label="Copy command" />
                  </div>
                ))}
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground">Used in {k.places.length} place{k.places.length === 1 ? '' : 's'} on the Mac{k.cloud.length ? ` and ${k.cloud.length} in the cloud` : ''}</summary>
                  <ul className="mt-1.5 space-y-0.5 pl-4 list-disc">
                    {k.places.map((p, i) => (
                      <li key={i} className="break-all"><code>{p.path}{p.line ? `:${p.line}` : ''}</code>{p.field !== k.name && <span className="text-muted-foreground"> ({p.field})</span>}{p.note && <span className="text-muted-foreground"> — {p.note}</span>}</li>
                    ))}
                    {k.cloud.map(c => <li key={c} className="text-muted-foreground">{c} (same name)</li>)}
                  </ul>
                </details>
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-base">In the cloud (names only)</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-xs">
          <CloudList title={`Vercel env (${vercel.length} projects)`} error={row.cloud.vercel?.error}
            items={vercel.filter(p => p.envs.length).map(p => `${p.project}: ${p.envs.map(e => e.name).join(', ')}`)} />
          <CloudList title={`GitHub Actions secrets (${row.cloud.github?.checked ?? 0} repos checked)`} error={row.cloud.github?.error}
            items={github.filter(r => r.secrets.length || r.dependabot.length).map(r => `${r.repo}: ${[...r.secrets, ...r.dependabot].join(', ')}`)} />
          <CloudList title={`Google Cloud API keys (${row.cloud.gcp?.project ?? '?'})`} error={row.cloud.gcp?.error}
            items={(row.cloud.gcp?.keys ?? []).map(k => `${k.name}${k.apis?.length ? `: ${k.apis.join(', ')}` : ': no API restriction'}`)} />
          <CloudList title="Neon projects" error={row.cloud.neon?.error} items={(row.cloud.neon?.projects ?? []).map(p => p.name)} />
          {row.blocked.length > 0 && <CloudList title="Couldn't read" items={row.blocked.map(b => `${b.path}: ${b.error}`)} />}
        </CardContent>
      </Card>
    </>
  )
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

function CloudList({ title, items, error }: { title: string; items: string[]; error?: string }) {
  return (
    <div>
      <p className="font-medium">{title}</p>
      {error ? <p className="text-amber-600">{error}</p> : items.length === 0 ? <p className="text-muted-foreground">none</p> : (
        <ul className="mt-1 space-y-0.5 pl-4 list-disc text-muted-foreground">{items.map(i => <li key={i} className="break-all">{i}</li>)}</ul>
      )}
    </div>
  )
}
