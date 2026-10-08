import { auth, signOut } from '@/lib/auth'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { db } from '@/lib/db'
import { users, repositories } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { formatDistanceToNow } from '@/lib/utils'
import { GitFork, CreditCard, Sparkles, Bell, Bot, ChevronRight } from 'lucide-react'
import { PublicProfileToggle } from '@/components/settings/public-profile-toggle'
import { StripeConnect } from '@/components/settings/stripe-connect'
import { ProfileReadmeGenerator } from '@/components/settings/profile-readme-generator'
import { LLMSettings } from '@/components/settings/llm-settings'
import { NotificationSettings } from '@/components/settings/notification-settings'
import { AutoDispatchSettings } from '@/components/settings/auto-dispatch-settings'
import { getLLMSettings } from '@/lib/actions/llm'
import { hasStripeKey, stripeKeySource } from '@/lib/actions/stripe'
import { getNotificationSettings } from '@/lib/actions/notifications'
import { getAutoDispatchSettings } from '@/lib/actions/auto-dispatch-settings'

/**
 * Only what you change lives here (2026-10-08 review). Status moved to where it's watched: sync
 * history and the scheduled jobs to the Agents page, goals and weekly hours to the dashboard's
 * "More insights" next to the cards that use them.
 */
export default async function SettingsPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const [user, stripeConnected, stripeSource, repoList, llmSettings, notifSettings, autoDispatchSettingsData] = await Promise.all([
    db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: { githubLogin: true, createdAt: true, publicProfile: true },
    }),
    hasStripeKey(),
    stripeKeySource(),
    db.query.repositories.findMany({
      where: eq(repositories.userId, session.user.id),
      columns: { id: true, name: true, stripeProductId: true },
      orderBy: (r, { asc }) => [asc(r.name)],
    }),
    getLLMSettings(),
    getNotificationSettings(),
    getAutoDispatchSettings(),
  ])

  const initials = session.user.name?.split(' ').map((n) => n[0]).join('').toUpperCase() ?? '?'
  const ownsFactory = process.env.FACTORY_USER_ID === session.user.id

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm mt-1">AI provider, alerts, agents, revenue and your public profile</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Sparkles className="w-4 h-4" />AI provider</CardTitle>
        </CardHeader>
        <CardContent>
          <LLMSettings initialProvider={llmSettings.provider} keySource={llmSettings.keySource} savedProviders={llmSettings.savedProviders} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Bell className="w-4 h-4" />Notifications</CardTitle>
        </CardHeader>
        <CardContent>
          <NotificationSettings
            savedWebhookHint={notifSettings?.webhookHint ?? null}
            initialThreshold={notifSettings?.healthAlertThreshold ?? 55}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><Bot className="w-4 h-4 text-indigo-500" />Agents</CardTitle>
          <p className="text-xs text-muted-foreground">
            The factory on your Mac runs every agent request: sandboxed, on free models, as draft PRs you merge.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs">
            <span className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${ownsFactory ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`} />
              {ownsFactory
                ? `Factory: yours${process.env.REDIS_URL ? ', queue connected' : ', no REDIS_URL (requests wait for the next scheduled cycle)'}`
                : process.env.FACTORY_USER_ID ? 'Factory: runs for another account' : 'Factory: not set up (FACTORY_USER_ID and REDIS_URL in Vercel)'}
            </span>
            <Link href="/agent-performance" className="flex items-center gap-0.5 text-muted-foreground hover:text-foreground">
              Worker, queue, schedules and runs <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="space-y-1">
            <p className="text-sm font-medium">Monday auto-dispatch</p>
            <p className="text-xs text-muted-foreground">Queue the advisor&apos;s actions for the factory every Monday morning.</p>
          </div>
          <AutoDispatchSettings
            initialEnabled={autoDispatchSettingsData?.autoDispatchEnabled ?? false}
            initialEffortGate={autoDispatchSettingsData?.autoDispatchEffortGate ?? 'quick_only'}
            initialMaxPerRun={autoDispatchSettingsData?.autoDispatchMaxPerRun ?? 3}
            initialSkipSecurity={autoDispatchSettingsData?.autoDispatchSkipSecurity ?? true}
            initialAccuracyThreshold={autoDispatchSettingsData?.autoDispatchAccuracyThreshold ?? 0}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><CreditCard className="w-4 h-4" />Revenue</CardTitle>
        </CardHeader>
        <CardContent>
          <StripeConnect connected={stripeConnected} keySource={stripeSource} repos={repoList} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2"><GitFork className="w-4 h-4" />Public profile</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <PublicProfileToggle enabled={user?.publicProfile ?? false} username={user?.githubLogin} />
          {user?.publicProfile && user?.githubLogin && (
            <details className="group rounded-lg border border-border/60">
              <summary className="cursor-pointer select-none list-none px-3 py-2 text-sm font-medium flex items-center gap-1">
                <ChevronRight className="w-3.5 h-3.5 transition-transform group-open:rotate-90" />
                GitHub profile README
                <span className="ml-1 text-xs font-normal text-muted-foreground">generated from your top repos</span>
              </summary>
              <div className="px-3 pb-3">
                <ProfileReadmeGenerator username={user.githubLogin} previewMarkdown="" />
              </div>
            </details>
          )}
        </CardContent>
      </Card>

      {/* Account: read-only, so one line instead of two cards. */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-5">
        <div className="flex items-center gap-3 min-w-0">
          <Avatar className="w-9 h-9">
            <AvatarImage src={session.user.image ?? undefined} />
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">
              {session.user.name}
              {user?.githubLogin && <span className="font-normal text-muted-foreground"> · @{user.githubLogin}</span>}
            </p>
            <p className="text-xs text-muted-foreground" title="GitHub scopes: repo, read:user, read:org, read:project, read:packages, security_events">
              Signed in with GitHub (private repos and security alerts) · joined {formatDistanceToNow(user?.createdAt ?? null)}
            </p>
          </div>
        </div>
        <form action={async () => {
          'use server'
          await signOut({ redirectTo: '/login' })
        }}>
          <Button variant="outline" size="sm" type="submit">Sign out</Button>
        </form>
      </div>
    </div>
  )
}
