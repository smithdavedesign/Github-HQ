import {
  pgTable,
  text,
  integer,
  boolean,
  timestamp,
  date,
  serial,
  real,
  numeric,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// ─── Auth.js required tables ─────────────────────────────────────────────────

export const accounts = pgTable(
  'accounts',
  {
    userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    type: text('type').notNull(),
    provider: text('provider').notNull(),
    providerAccountId: text('provider_account_id').notNull(),
    refresh_token: text('refresh_token'),
    access_token: text('access_token'),
    expires_at: integer('expires_at'),
    token_type: text('token_type'),
    scope: text('scope'),
    id_token: text('id_token'),
    session_state: text('session_state'),
  },
  (account) => [
    primaryKey({ columns: [account.provider, account.providerAccountId] }),
  ],
)

export const sessions = pgTable('sessions', {
  sessionToken: text('session_token').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  expires: timestamp('expires', { mode: 'date' }).notNull(),
})

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    identifier: text('identifier').notNull(),
    token: text('token').notNull(),
    expires: timestamp('expires', { mode: 'date' }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })],
)

// ─── Users ───────────────────────────────────────────────────────────────────

export const users = pgTable('users', {
  id: text('id').primaryKey(),
  name: text('name'),
  email: text('email').unique(),
  emailVerified: timestamp('email_verified', { mode: 'date' }),
  image: text('image'),
  githubId: integer('github_id').unique(),
  githubLogin: text('github_login'),
  githubToken: text('github_token'), // stored encrypted by Auth.js adapter
  lastSyncedAt: timestamp('last_synced_at', { mode: 'date' }),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  // Phase 7: public portfolio
  publicProfile: boolean('public_profile').default(false),
  // Phase 25: hours available per week for time allocation
  hoursPerWeek: integer('hours_per_week').default(10),
  // Phase 37: Stripe integration
  stripeApiKey: text('stripe_api_key'),
  // Phase 44: Bring Your Own LLM Key
  llmProvider: text('llm_provider').default('anthropic'), // anthropic | openai | gemini
  llmApiKey: text('llm_api_key'),   // legacy single-key field (kept for migration safety)
  llmKeys: jsonb('llm_keys').$type<Partial<Record<string, string>>>(), // { anthropic?, openai?, gemini? }
})

// ─── Repositories ─────────────────────────────────────────────────────────────

export const repositories = pgTable('repositories', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  githubId: integer('github_id').notNull(),
  name: text('name').notNull(),
  owner: text('owner').notNull(),
  fullName: text('full_name').notNull(),
  visibility: text('visibility').notNull().default('public'), // public | private | internal
  description: text('description'),
  defaultBranch: text('default_branch').default('main'),
  homepage: text('homepage'),
  stars: integer('stars').default(0),
  forks: integer('forks').default(0),
  language: text('language'),
  isArchived: boolean('is_archived').default(false),
  isFork: boolean('is_fork').default(false),
  isRevenueGenerating: boolean('is_revenue_generating').default(false),
  tags: text('tags').array().default([]),
  // Phase 11: Repository lifecycle status
  lifecycleStatus: text('lifecycle_status').default('maintaining'),
  // idea | building | beta | production | growing | maintaining | sunsetting | archived
  // Phase 21: Purpose field + Focus flag
  purpose: text('purpose'),
  // Revenue | Learning | Consulting | Experiment | Open Source | Client Work | Portfolio | Infrastructure
  isFocused: boolean('is_focused').default(false),
  // Phase 23: Itemized cost tracking
  costItems: jsonb('cost_items').$type<Array<{ label: string; amount: number }>>(),
  // Phase 26: Opportunity vs Effort Matrix
  estimatedEffort: text('estimated_effort').default('medium'), // low | medium | high
  // Phase 27: Idea Graveyard
  abandonmentReason: text('abandonment_reason'),
  // Phase 37: Stripe product mapping
  stripeProductId: text('stripe_product_id'),
  // No demand | Too competitive | Too much maintenance | Lost interest | Merged | Pivoted,
  // Revenue & cost fields (Phase 3)
  mrr: numeric('mrr', { precision: 10, scale: 2 }).default('0'),
  arr: numeric('arr', { precision: 10, scale: 2 }).default('0'),
  monthlyCost: numeric('monthly_cost', { precision: 10, scale: 2 }).default('0'),
  aiSummary: jsonb('ai_summary'), // { what_it_does, maturity, risk, recommendations[] }
  aiSummaryGeneratedAt: timestamp('ai_summary_generated_at', { mode: 'date' }),
  // Phase 5: Deep Claude analysis
  claudeAnalysis: jsonb('claude_analysis'), // { architecture, security, quality, techDebt, recommendations, score }
  claudeAnalysisAt: timestamp('claude_analysis_at', { mode: 'date' }),
  createdAt: timestamp('created_at', { mode: 'date' }).notNull(),
  updatedAt: timestamp('updated_at', { mode: 'date' }).notNull(),
  syncedAt: timestamp('synced_at', { mode: 'date' }).defaultNow(),
}, (table) => [
  index('repos_user_id_idx').on(table.userId),
  uniqueIndex('repos_github_id_idx').on(table.githubId),
])

// ─── Repository Metrics ───────────────────────────────────────────────────────

export const repositoryMetrics = pgTable('repository_metrics', {
  id: serial('id').primaryKey(),
  repoId: integer('repo_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }).unique(),
  healthScore: real('health_score').default(0),
  activityScore: real('activity_score').default(0),
  securityScore: real('security_score').default(100),
  documentationScore: real('documentation_score').default(0),
  testingScore: real('testing_score').default(0),
  dependencyScore: real('dependency_score').default(50),
  qualityScore: real('quality_score').default(70),
  lastCommit: timestamp('last_commit', { mode: 'date' }),
  lastPush: timestamp('last_push', { mode: 'date' }),
  openIssues: integer('open_issues').default(0),
  openPrs: integer('open_prs').default(0),
  weeklyCommits: integer('weekly_commits').default(0),
  monthlyCommits: integer('monthly_commits').default(0),
  quarterlyCommits: integer('quarterly_commits').default(0),
  activityStatus: text('activity_status').default('unknown'), // Actively Maintained | Low Activity | Dormant | Abandoned
  buildStatus: text('build_status'), // success | failure | cancelled | in_progress | null
  opportunityScore: real('opportunity_score').default(0), // Phase 4: 0-100 weighted score
  weeklyCommitData: jsonb('weekly_commit_data'), // last 13 weeks: [{ week: timestamp, total: number }]
  // Phase 22: Archive candidate score
  archiveScore: real('archive_score').default(0), // 0-100: higher = stronger archive candidate
  // Phase 15: Repository Valuation
  estimatedValue: integer('estimated_value').default(0),   // USD
  // Phase 29: internal deps — names of repos in this portfolio that this repo depends on
  internalDeps: jsonb('internal_deps').$type<string[]>(),
  valuationConfidence: text('valuation_confidence').default('none'), // none|very_low|low|medium|high
  valuationMethod: text('valuation_method').default('signal_based'), // saas_multiple|signal_based|archived
  calculatedAt: timestamp('calculated_at', { mode: 'date' }).defaultNow(),
}, (table) => [
  index('metrics_repo_id_idx').on(table.repoId),
])

// ─── Tech Stack ───────────────────────────────────────────────────────────────

export const techStack = pgTable('tech_stack', {
  id: serial('id').primaryKey(),
  repoId: integer('repo_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }).unique(),
  frontend: text('frontend'),   // Next.js | React | Vue | etc.
  backend: text('backend'),     // Express | Node | Server Actions | etc.
  database: text('database'),   // PostgreSQL | MySQL | MongoDB | etc.
  hosting: text('hosting'),     // Vercel | AWS | Render | etc.
  language: text('language'),   // TypeScript | JavaScript | Python | etc.
  testing: text('testing'),     // Jest | Vitest | Cypress | etc.
  analytics: text('analytics'), // PostHog | Mixpanel | Vercel Analytics | etc.
  aiTools: text('ai_tools'),    // Claude | OpenAI | etc.
  ciCd: text('ci_cd'),          // GitHub Actions | CircleCI | etc.
  detectedAt: timestamp('detected_at', { mode: 'date' }).defaultNow(),
})

// ─── Deployments ──────────────────────────────────────────────────────────────

export const deployments = pgTable('deployments', {
  id: serial('id').primaryKey(),
  repoId: integer('repo_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  provider: text('provider'), // vercel | netlify | render | railway | github-pages | custom
  name: text('name'), // optional display name (e.g. "Production", "Preview")
  status: text('status').default('unknown'), // healthy | slow | down | unknown
  lastChecked: timestamp('last_checked', { mode: 'date' }),
  responseTimeMs: integer('response_time_ms'),
  sslValid: boolean('ssl_valid'),
  sslExpiry: timestamp('ssl_expiry', { mode: 'date' }),
  httpStatus: integer('http_status'),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
}, (table) => [
  index('deployments_repo_id_idx').on(table.repoId),
])

// ─── Security Findings ────────────────────────────────────────────────────────

export const securityFindings = pgTable('security_findings', {
  id: serial('id').primaryKey(),
  repoId: integer('repo_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }),
  githubAlertId: integer('github_alert_id'),
  type: text('type').notNull(), // dependabot | secret | vulnerability | license
  severity: text('severity').notNull(), // critical | high | medium | low | info
  title: text('title').notNull(),
  description: text('description'),
  packageName: text('package_name'),
  state: text('state').default('open'), // open | dismissed | fixed
  dismissedAt: timestamp('dismissed_at', { mode: 'date' }),
  fixedAt: timestamp('fixed_at', { mode: 'date' }),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
}, (table) => [
  index('security_repo_id_idx').on(table.repoId),
  index('security_severity_idx').on(table.severity),
  index('security_state_idx').on(table.state),
])

// ─── Scans ────────────────────────────────────────────────────────────────────

export const scans = pgTable('scans', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // sync | security | deployment | ai
  status: text('status').default('pending'), // pending | running | complete | failed
  totalRepos: integer('total_repos').default(0),
  processedRepos: integer('processed_repos').default(0),
  error: text('error'),
  startedAt: timestamp('started_at', { mode: 'date' }).defaultNow(),
  completedAt: timestamp('completed_at', { mode: 'date' }),
}, (table) => [
  index('scans_user_id_idx').on(table.userId),
])

// ─── Health Score History (Phase 9 — drift detection) ────────────────────────

export const healthScoreHistory = pgTable('health_score_history', {
  id: serial('id').primaryKey(),
  repoId: integer('repo_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }),
  healthScore: real('health_score').notNull(),
  activityScore: real('activity_score'),
  securityScore: real('security_score'),
  recordedDate: date('recorded_date').notNull(),  // deduplication key: one row per repo per day
  recordedAt: timestamp('recorded_at', { mode: 'date' }).defaultNow(),
}, (table) => [
  uniqueIndex('hsh_repo_date_idx').on(table.repoId, table.recordedDate),
  index('hsh_repo_id_idx').on(table.repoId),
])

// ─── Digests (Phase 8 — weekly triage briefing) ───────────────────────────────

export const digests = pgTable('digests', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  content: jsonb('content').notNull(),         // DigestContent: { summary, priorities[], generatedAt }
  advisorContent: jsonb('advisor_content'),    // AdvisorContent: { headline, actions[], portfolioInsight }
  ceoReport: jsonb('ceo_report'),              // Phase 24: CeoReportContent
  generatedAt: timestamp('generated_at', { mode: 'date' }).defaultNow(),
}, (table) => [
  index('digests_user_id_idx').on(table.userId),
])

// ─── Goals (Phase 17) ────────────────────────────────────────────────────────

export const goals = pgTable('goals', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // mrr | health_avg | repos_live | revenue_repos | custom
  name: text('name').notNull(),
  targetValue: real('target_value').notNull(),
  currentValue: real('current_value').default(0),
  unit: text('unit').default(''),   // '$', 'repos', 'score', or custom label
  deadline: date('deadline'),       // optional target date YYYY-MM-DD
  notes: text('notes'),
  isActive: boolean('is_active').default(true),
  completedAt: timestamp('completed_at', { mode: 'date' }),
  createdAt: timestamp('created_at', { mode: 'date' }).defaultNow(),
}, (table) => [
  index('goals_user_id_idx').on(table.userId),
])

// ─── Portfolio Score History (Phase 30) ──────────────────────────────────────

export const portfolioScoreHistory = pgTable('portfolio_score_history', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  score: real('score').notNull(),            // 0-100 composite
  avgHealth: real('avg_health'),
  activityRatio: real('activity_ratio'),     // % of repos Actively Maintained
  revenueScore: real('revenue_score'),
  diversityScore: real('diversity_score'),
  recordedDate: date('recorded_date').notNull(),
}, (table) => [
  uniqueIndex('psh_user_date_idx').on(table.userId, table.recordedDate),
  index('psh_user_id_idx').on(table.userId),
])

// ─── Portfolio Events (Phase 28 — Personal Changelog) ────────────────────────

export const portfolioEvents = pgTable('portfolio_events', {
  id: serial('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  repoId: integer('repo_id').references(() => repositories.id, { onDelete: 'set null' }),
  eventType: text('event_type').notNull(),
  // repo_created | repo_archived | mrr_changed | health_milestone | first_revenue | manual_milestone
  title: text('title').notNull(),
  description: text('description'),
  metadata: jsonb('metadata'), // e.g. { from: 0, to: 50 } for mrr_changed, { threshold: 80 } for health_milestone
  dedupKey: text('dedup_key'), // nullable — unique per (userId, dedupKey) to prevent duplicate one-time events
  occurredAt: timestamp('occurred_at', { mode: 'date' }).defaultNow().notNull(),
}, (table) => [
  index('events_user_id_idx').on(table.userId),
  index('events_occurred_at_idx').on(table.occurredAt),
  uniqueIndex('events_user_dedup_idx').on(table.userId, table.dedupKey),
])

// ─── Relations ────────────────────────────────────────────────────────────────

export const usersRelations = relations(users, ({ many }) => ({
  repositories: many(repositories),
  scans: many(scans),
  portfolioEvents: many(portfolioEvents),
  portfolioScoreHistory: many(portfolioScoreHistory),
}))

export const repositoriesRelations = relations(repositories, ({ one, many }) => ({
  user: one(users, { fields: [repositories.userId], references: [users.id] }),
  metrics: one(repositoryMetrics, { fields: [repositories.id], references: [repositoryMetrics.repoId] }),
  techStack: one(techStack, { fields: [repositories.id], references: [techStack.repoId] }),
  deployments: many(deployments),
  securityFindings: many(securityFindings),
}))

export const repositoryMetricsRelations = relations(repositoryMetrics, ({ one }) => ({
  repository: one(repositories, { fields: [repositoryMetrics.repoId], references: [repositories.id] }),
}))

export const techStackRelations = relations(techStack, ({ one }) => ({
  repository: one(repositories, { fields: [techStack.repoId], references: [repositories.id] }),
}))

export const deploymentsRelations = relations(deployments, ({ one }) => ({
  repository: one(repositories, { fields: [deployments.repoId], references: [repositories.id] }),
}))

export const securityFindingsRelations = relations(securityFindings, ({ one }) => ({
  repository: one(repositories, { fields: [securityFindings.repoId], references: [repositories.id] }),
}))

export const scansRelations = relations(scans, ({ one }) => ({
  user: one(users, { fields: [scans.userId], references: [users.id] }),
}))

export const healthScoreHistoryRelations = relations(healthScoreHistory, ({ one }) => ({
  repository: one(repositories, { fields: [healthScoreHistory.repoId], references: [repositories.id] }),
}))

export const digestsRelations = relations(digests, ({ one }) => ({
  user: one(users, { fields: [digests.userId], references: [users.id] }),
}))

export const goalsRelations = relations(goals, ({ one }) => ({
  user: one(users, { fields: [goals.userId], references: [users.id] }),
}))

export const portfolioScoreHistoryRelations = relations(portfolioScoreHistory, ({ one }) => ({
  user: one(users, { fields: [portfolioScoreHistory.userId], references: [users.id] }),
}))

export const portfolioEventsRelations = relations(portfolioEvents, ({ one }) => ({
  user: one(users, { fields: [portfolioEvents.userId], references: [users.id] }),
  repository: one(repositories, { fields: [portfolioEvents.repoId], references: [repositories.id] }),
}))

// ─── Types ────────────────────────────────────────────────────────────────────

export type User = typeof users.$inferSelect
export type Repository = typeof repositories.$inferSelect
export type RepositoryMetrics = typeof repositoryMetrics.$inferSelect
export type TechStack = typeof techStack.$inferSelect
export type Deployment = typeof deployments.$inferSelect
export type SecurityFinding = typeof securityFindings.$inferSelect
export type Scan = typeof scans.$inferSelect
export type InsertRepository = typeof repositories.$inferInsert
export type InsertRepositoryMetrics = typeof repositoryMetrics.$inferInsert
export type InsertTechStack = typeof techStack.$inferInsert
export type InsertDeployment = typeof deployments.$inferInsert
export type InsertSecurityFinding = typeof securityFindings.$inferInsert
export type HealthScoreHistory = typeof healthScoreHistory.$inferSelect
export type Digest = typeof digests.$inferSelect
export type Goal = typeof goals.$inferSelect
export type InsertGoal = typeof goals.$inferInsert

// Phase 21/22/23/24 convenience types
export type RepoPurpose =
  | 'Revenue'
  | 'Learning'
  | 'Consulting'
  | 'Experiment'
  | 'Open Source'
  | 'Client Work'
  | 'Portfolio'
  | 'Infrastructure'
  | 'Reference'

export type CostItem = { label: string; amount: number }
export type PortfolioScoreHistory = typeof portfolioScoreHistory.$inferSelect
export type PortfolioEvent = typeof portfolioEvents.$inferSelect
export type InsertPortfolioEvent = typeof portfolioEvents.$inferInsert
