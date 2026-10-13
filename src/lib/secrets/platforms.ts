/**
 * Settings → Keys: which platform issued each secret, and where to rotate it. Pure, so the mapping is tested
 * (tests/unit/secret-platforms.test.ts). The scan (`~/ai-stack/secrets/scan.py`) names a platform from the value's
 * shape where it can; the variable name decides the rest.
 */

export type Platform = {
  key: string
  label: string
  /** Where a new key is made and the old one revoked. Absent for secrets you generate yourself. */
  rotateUrl?: string
  /** One line: how to rotate, including what to update afterwards. */
  how: string
}

const SELF = 'Generate a new one (`openssl rand -hex 32`), update every place below, redeploy, then drop the old one.'

export const PLATFORMS: Record<string, Platform> = {
  anthropic: { key: 'anthropic', label: 'Anthropic', rotateUrl: 'https://console.anthropic.com/settings/keys', how: 'Create a key, update every place below, then delete the old key in the console.' },
  openai: { key: 'openai', label: 'OpenAI', rotateUrl: 'https://platform.openai.com/api-keys', how: 'Create a project key, update every place below, then revoke the old one.' },
  openrouter: { key: 'openrouter', label: 'OpenRouter', rotateUrl: 'https://openrouter.ai/settings/keys', how: 'Create a key, update every place below, then delete the old one.' },
  gemini: { key: 'gemini', label: 'Google Gemini / Cloud API key', rotateUrl: 'https://console.cloud.google.com/apis/credentials', how: 'Credentials → the key → Rotate key (keeps the old one working until you delete it); AI Studio keys: aistudio.google.com/app/apikey.' },
  'google-oauth': { key: 'google-oauth', label: 'Google OAuth client', rotateUrl: 'https://console.cloud.google.com/auth/clients', how: 'The OAuth client → Add secret, deploy it, then disable and delete the old secret.' },
  'github-token': { key: 'github-token', label: 'GitHub token', rotateUrl: 'https://github.com/settings/tokens', how: 'Prefer a fine-grained token limited to the repos and permissions it needs, with an expiry; then delete the old token.' },
  'github-app': { key: 'github-app', label: 'GitHub App / OAuth app', rotateUrl: 'https://github.com/settings/apps', how: 'App → Generate a private key or a new client secret, deploy it, then delete the old one. OAuth apps: github.com/settings/developers.' },
  slack: { key: 'slack', label: 'Slack app', rotateUrl: 'https://api.slack.com/apps', how: 'Your app → OAuth & Permissions (bot token) or Basic Information (app token, signing secret) → rotate/regenerate, then update OpenClaw and the keychain (`bin/secrets` has the steps).' },
  stripe: { key: 'stripe', label: 'Stripe', rotateUrl: 'https://dashboard.stripe.com/apikeys', how: 'Roll the key (Stripe can keep the old one alive for a while), update every place below. Webhook secrets: dashboard.stripe.com/webhooks → the endpoint → Roll secret.' },
  supabase: { key: 'supabase', label: 'Supabase', rotateUrl: 'https://supabase.com/dashboard/project/_/settings/api-keys', how: 'Project → API keys: create a new secret key, deploy it, then revoke the old one. The anon/publishable key is public by design.' },
  neon: { key: 'neon', label: 'Neon Postgres', rotateUrl: 'https://console.neon.tech/app/projects', how: 'Project → Roles → Reset password, then update DATABASE_URL everywhere below (Vercel env included) and redeploy.' },
  postgres: { key: 'postgres', label: 'Postgres', how: 'Change the role password on the database server, then update the URL everywhere below.' },
  vercel: { key: 'vercel', label: 'Vercel token', rotateUrl: 'https://vercel.com/account/settings/tokens', how: 'Create a token scoped to the team with an expiry, store it (`provision-vercel-token`), then delete the old one.' },
  resend: { key: 'resend', label: 'Resend', rotateUrl: 'https://resend.com/api-keys', how: 'Create a sending-only key for the domain, update every place below, delete the old key.' },
  sentry: { key: 'sentry', label: 'Sentry DSN', rotateUrl: 'https://sentry.io/settings/projects/', how: 'Project → Client Keys (DSN) → generate a new key, deploy, then disable the old one. A DSN is semi-public.' },
  mapbox: { key: 'mapbox', label: 'Mapbox', rotateUrl: 'https://account.mapbox.com/access-tokens/', how: 'Create a token restricted to your URLs, deploy, then delete the old one.' },
  maptiler: { key: 'maptiler', label: 'MapTiler', rotateUrl: 'https://cloud.maptiler.com/account/keys/', how: 'Create a key with allowed origins, deploy, then delete the old one.' },
  deepseek: { key: 'deepseek', label: 'DeepSeek', rotateUrl: 'https://platform.deepseek.com/api_keys', how: 'Create a key, update every place below, delete the old one.' },
  ollama: { key: 'ollama', label: 'Ollama cloud', rotateUrl: 'https://ollama.com/settings/keys', how: 'Create a key, update LiteLLM, OpenClaw and the LaunchAgent below, then delete the old one.' },
  litellm: { key: 'litellm', label: 'LiteLLM master key (local)', how: 'Run `~/ai-stack/bin/secrets rotate litellm`: new key, every copy updated, services restarted.' },
  linkedin: { key: 'linkedin', label: 'LinkedIn app', rotateUrl: 'https://www.linkedin.com/developers/apps', how: 'App → Auth → generate a new client secret; access tokens expire on their own and are re-issued by signing in.' },
  bluesky: { key: 'bluesky', label: 'Bluesky app password', rotateUrl: 'https://bsky.app/settings/app-passwords', how: 'Add a new app password, update the place below, delete the old one.' },
  notion: { key: 'notion', label: 'Notion integration', rotateUrl: 'https://www.notion.so/profile/integrations', how: 'The integration → Refresh the secret, then update the place below.' },
  nps: { key: 'nps', label: 'NPS API', rotateUrl: 'https://www.nps.gov/subjects/developer/get-started.htm', how: 'Request a new key by email form, update the place below.' },
  'recreation-gov': { key: 'recreation-gov', label: 'Recreation.gov (RIDB)', rotateUrl: 'https://ridb.recreation.gov/profile', how: 'Profile → generate a new API key, update the place below.' },
  aviationstack: { key: 'aviationstack', label: 'Aviationstack', rotateUrl: 'https://aviationstack.com/dashboard', how: 'Dashboard → reset the access key, update the place below.' },
  redis: { key: 'redis', label: 'Redis (Upstash)', rotateUrl: 'https://console.upstash.com/', how: 'Database → reset the password/token, update REDIS_URL everywhere below.' },
  whatsapp: { key: 'whatsapp', label: 'WhatsApp link (OpenClaw)', how: 'No key: unlink the device in WhatsApp → Linked devices, then link again with `openclaw` and the QR code.' },
  ssh: { key: 'ssh', label: 'SSH key', rotateUrl: 'https://github.com/settings/keys', how: '`ssh-keygen -t ed25519` with a passphrase, add the new public key where the old one is used, then remove the old one.' },
  'private-key': { key: 'private-key', label: 'Private key file', how: 'Issue a new key where it came from (e.g. the GitHub App settings), replace the file, then revoke the old key.' },
  minio: { key: 'minio', label: 'MinIO (local)', how: 'Change MINIO_ROOT_PASSWORD and recreate the local container.' },
  openclaw: { key: 'openclaw', label: 'OpenClaw gateway (local)', how: `${SELF} Restart with \`openclaw gateway restart\`.` },
  self: { key: 'self', label: 'Generated secrets (yours)', how: SELF },
  other: { key: 'other', label: 'Other', how: 'Find the issuer from the name and the places below; rotate there, then update every place.' },
}

/** Names you generate yourself: auth/session/cron/signing secrets. ENCRYPTION_KEY is special (see `rotationWarning`). */
const SELF_NAMES = /(^|_)(AUTH_SECRET|NEXTAUTH_SECRET|SESSION_SECRET|CRON_SECRET|ENCRYPTION_KEY|INTERNAL_[A-Z_]*|[A-Z_]*SIGNING_SECRET|WEBHOOK_SHARED_SECRET|[A-Z_]*STATE_SECRET|ADMIN_PASSWORD|FAMILY_SECRET_CODE|VAPID_PRIVATE_KEY|JWT_SECRET)$/

/** The scan's platform and the variable name → a key in PLATFORMS. */
export function platformKey(name: string, scanned: string): string {
  const n = name.toUpperCase()
  if (/GITHUB_APP_PRIVATE_KEY|GITHUB_CLIENT_SECRET|GITHUB_APP_/.test(n) || (scanned === 'private-key' && n.includes('GITHUB'))) return 'github-app'
  if (n === 'MINIO_ROOT_PASSWORD') return 'minio'
  if (/GATEWAY\.AUTH\.TOKEN/.test(n)) return 'openclaw'
  if (SELF_NAMES.test(n) && !n.startsWith('STRIPE') && !n.startsWith('SLACK')) return 'self'
  if (/GOOGLE_CLIENT_SECRET|AUTH_GOOGLE_SECRET/.test(n)) return 'google-oauth'
  const direct: Record<string, string> = {
    anthropic: 'anthropic', openai: 'openai', openrouter: 'openrouter', litellm: 'litellm', slack: 'slack', stripe: 'stripe',
    google: 'gemini', neon: 'neon', 'supabase-db': 'supabase', postgres: 'postgres', redis: 'redis', resend: 'resend',
    sentry: 'sentry', mapbox: 'mapbox', vercel: 'vercel', notion: 'notion', deepseek: 'deepseek', ollama: 'ollama',
    maptiler: 'maptiler', linkedin: 'linkedin', bluesky: 'bluesky', nps: 'nps', 'recreation-gov': 'recreation-gov',
    aviationstack: 'aviationstack', whatsapp: 'whatsapp', ssh: 'ssh', 'private-key': 'private-key', upstash: 'redis',
    minio: 'minio', github: 'github-token', supabase: 'supabase',
  }
  if (scanned.startsWith('supabase')) return 'supabase'
  if (direct[scanned]) return direct[scanned]
  if (n.includes('SLACK')) return 'slack'
  if (n.includes('DATABASE_URL') || n.includes('DIRECT_URL')) return 'postgres'
  return 'other'
}

/** A warning shown before rotating, where rotating naively breaks something. */
export function rotationWarning(name: string): string | null {
  const n = name.toUpperCase()
  if (n === 'ENCRYPTION_KEY') return 'Data in the database is encrypted with this key: decrypt and re-encrypt it with the new key before switching, or it becomes unreadable.'
  if (n === 'AUTH_SECRET' || n === 'NEXTAUTH_SECRET') return 'Rotating signs everyone out.'
  if (n.includes('DATABASE_URL')) return 'Every app and job that reads this database needs the new URL at the same time.'
  return null
}

/** The command that copies a keychain item to the clipboard (never shows it). */
export function keychainCommand(service: string): string {
  return `security find-generic-password -s '${service.replace(/'/g, `'\\''`)}' -w | pbcopy`
}
