import { auth, signOut } from '@/lib/auth'
import { redirect } from 'next/navigation'
import { db } from '@/lib/db'
import { users, scans } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { formatDistanceToNow } from '@/lib/utils'
import { Shield, Clock, GitFork, Cpu, Target, CreditCard, FileCode, Sparkles, Workflow, Bell, Bot } from 'lucide-react'
import { PublicProfileToggle } from '@/components/settings/public-profile-toggle'
import { GoalManager } from '@/components/settings/goal-manager'
import { HoursInput } from '@/components/settings/hours-input'
import { StripeConnect } from '@/components/settings/stripe-connect'
import { ProfileReadmeGenerator } from '@/components/settings/profile-readme-generator'
import { LLMSettings } from '@/components/settings/llm-settings'
import { NotificationSettings } from '@/components/settings/notification-settings'
import { AutoDispatchSettings } from '@/components/settings/auto-dispatch-settings'
import { getLLMSettings } from '@/lib/actions/llm'
import { getGoals } from '@/lib/actions/goals'
import { hasStripeKey, stripeKeySource } from '@/lib/actions/stripe'
import { getNotificationSettings } from '@/lib/actions/notifications'
import { getAutoDispatchSettings } from '@/lib/actions/auto-dispatch-settings'
import { repositories } from '@/lib/db/schema'

export default async function SettingsPage() {
  const session = await auth()
  if (!session?.user?.id) redirect('/login')

  const [user, recentScans, activeGoals, stripeConnected, stripeSource, repoList, llmSettings, notifSettings, autoDispatchSettingsData] = await Promise.all([
    db.query.users.findFirst({
      where: eq(users.id, session.user.id),
      columns: { id: true, name: true, email: true, image: true, githubLogin: true, lastSyncedAt: true, createdAt: true, publicProfile: true, hoursPerWeek: true },
    }),
    db.query.scans.findMany({
      where: eq(scans.userId, session.user.id),
      orderBy: [desc(scans.startedAt)],
      limit: 5,
    }),
    getGoals(),
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

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground text-sm mt-1">Account and sync configuration</p>
      </div>

      {/* AI Provider */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="w-4 h-4" />
            AI Provider
          </CardTitle>
        </CardHeader>
        <CardContent>
          <LLMSettings
            initialProvider={llmSettings.provider}
            keySource={llmSettings.keySource}
            savedProviders={llmSettings.savedProviders}
          />
        </CardContent>
      </Card>

      {/* Notifications */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Bell className="w-4 h-4" />
            Notifications
          </CardTitle>
        </CardHeader>
        <CardContent>
          <NotificationSettings
            initialWebhookUrl={notifSettings?.webhookUrl ?? ''}
            initialThreshold={notifSettings?.healthAlertThreshold ?? 55}
          />
        </CardContent>
      </Card>

      {/* Auto-dispatch */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Bot className="w-4 h-4 text-indigo-500" />
            Agent Auto-Dispatch
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Automatically queue advisor actions on Monday morning. You wake up with PRs ready to review.
          </p>
        </CardHeader>
        <CardContent>
          <AutoDispatchSettings
            initialEnabled={autoDispatchSettingsData?.autoDispatchEnabled ?? false}
            initialEffortGate={autoDispatchSettingsData?.autoDispatchEffortGate ?? 'quick_only'}
            initialMaxPerRun={autoDispatchSettingsData?.autoDispatchMaxPerRun ?? 3}
            initialSkipSecurity={autoDispatchSettingsData?.autoDispatchSkipSecurity ?? true}
            initialAccuracyThreshold={autoDispatchSettingsData?.autoDispatchAccuracyThreshold ?? 0}
          />
        </CardContent>
      </Card>

      {/* Profile */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Profile</CardTitle>
        </CardHeader>
        <CardContent className="flex items-center gap-4">
          <Avatar className="w-14 h-14">
            <AvatarImage src={session.user.image ?? undefined} />
            <AvatarFallback>{initials}</AvatarFallback>
          </Avatar>
          <div className="space-y-1">
            <p className="font-medium">{session.user.name}</p>
            <p className="text-sm text-muted-foreground">{session.user.email}</p>
            {user?.githubLogin && (
              <p className="text-xs text-muted-foreground">@{user.githubLogin}</p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* GitHub Access */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="w-4 h-4" />
            GitHub OAuth Scopes
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            RepoHQ was granted the following permissions when you signed in:
          </p>
          <div className="flex flex-wrap gap-2">
            {['repo', 'read:user', 'read:org', 'read:project', 'read:packages', 'security_events'].map((scope) => (
              <Badge key={scope} variant="outline" className="font-mono text-xs">{scope}</Badge>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            The <code className="bg-muted px-1 rounded">repo</code> scope is required to access private repositories.
          </p>
        </CardContent>
      </Card>

      {/* Sync Status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="w-4 h-4" />
            Sync History
          </CardTitle>
        </CardHeader>
        <CardContent>
          {recentScans.length === 0 ? (
            <p className="text-sm text-muted-foreground">No syncs yet. Use the Sync button in the top bar.</p>
          ) : (
            <div className="space-y-2">
              {recentScans.map((scan) => {
                const statusColor = scan.status === 'complete' ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20'
                  : scan.status === 'running' ? 'bg-blue-500/10 text-blue-600 border-blue-500/20'
                  : scan.status === 'failed' ? 'bg-red-500/10 text-red-600 border-red-500/20'
                  : 'bg-slate-500/10 text-slate-500 border-slate-500/20'

                return (
                  <div key={scan.id} className="flex items-center justify-between text-sm py-2 border-b last:border-0">
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className={`capitalize text-xs ${statusColor}`}>
                        {scan.status}
                      </Badge>
                      <span className="text-muted-foreground capitalize">{scan.type}</span>
                      {scan.totalRepos != null && scan.totalRepos > 0 && (
                        <span className="text-muted-foreground text-xs">
                          {scan.processedRepos}/{scan.totalRepos} repos
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(scan.startedAt)}
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Cron Schedule */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Cpu className="w-4 h-4" />
            Scheduled Jobs
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 text-sm">
            {[
              { label: 'GitHub Sync', schedule: 'Daily at 02:00 UTC', path: '/api/cron/sync' },
              { label: 'Security Scan', schedule: 'Daily at 03:00 UTC', path: '/api/cron/security' },
              { label: 'Deployment Checks', schedule: 'Daily at 04:00 UTC', path: '/api/cron/deployments' },
              { label: 'AI Summaries', schedule: 'Sundays at 05:00 UTC', path: '/api/cron/ai-summary' },
            ].map(({ label, schedule, path }) => (
              <div key={path} className="flex items-center justify-between py-1.5 border-b last:border-0">
                <div>
                  <p className="font-medium">{label}</p>
                  <p className="text-xs text-muted-foreground font-mono">{path}</p>
                </div>
                <span className="text-xs text-muted-foreground">{schedule}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Running on Vercel Hobby (daily limit). Upgrade to Pro for higher frequency.
          </p>
        </CardContent>
      </Card>

      {/* Stripe */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <CreditCard className="w-4 h-4" />
            Revenue Integration
          </CardTitle>
        </CardHeader>
        <CardContent>
          <StripeConnect connected={stripeConnected} keySource={stripeSource} repos={repoList} />
        </CardContent>
      </Card>

      {/* Goals */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Target className="w-4 h-4" />
            Goals
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <HoursInput initialHours={user?.hoursPerWeek ?? 10} />
          <div className="h-px bg-border/40" />
          <GoalManager initialGoals={activeGoals} />
        </CardContent>
      </Card>

      {/* Public Portfolio */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <GitFork className="w-4 h-4" />
            Portfolio
          </CardTitle>
        </CardHeader>
        <CardContent>
          <PublicProfileToggle
            enabled={user?.publicProfile ?? false}
            username={user?.githubLogin}
          />
        </CardContent>
      </Card>

      {/* GitHub Profile README — only shown when public profile is enabled */}
      {user?.publicProfile && user?.githubLogin && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <FileCode className="w-4 h-4" />
              GitHub Profile README
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ProfileReadmeGenerator
              username={user.githubLogin}
              previewMarkdown=""
            />
          </CardContent>
        </Card>
      )}

      <Separator />

      {/* Agent Execution — Nexus connection */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Workflow className="w-4 h-4" />
            Agent Execution
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Connect to AI-DevOps Nexus to queue advisor actions for agent execution.
            When configured, a &quot;Queue →&quot; button appears on each advisor action.
          </p>
          <div className="rounded-lg border border-border/60 bg-muted/30 p-4 space-y-2 text-xs font-mono">
            <p className="text-muted-foreground font-sans text-xs font-medium mb-2">Add to your environment variables:</p>
            <p><span className="text-indigo-400">NEXUS_API_URL</span>=https://your-nexus-instance.onrender.com</p>
            <p><span className="text-indigo-400">NEXUS_API_TOKEN</span>=nexus-your-service-token</p>
          </div>
          <div className="flex items-center gap-2">
            {process.env.NEXUS_API_URL ? (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="text-xs text-emerald-600 font-medium">Connected — {process.env.NEXUS_API_URL}</span>
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-muted-foreground/40" />
                <span className="text-xs text-muted-foreground">Not configured</span>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* Sign out */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Sign out</p>
          <p className="text-xs text-muted-foreground">
            Member since {formatDistanceToNow(user?.createdAt ?? null)}
          </p>
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
