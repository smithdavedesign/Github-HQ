import { describe, it, expect } from 'vitest'
import { PLATFORMS, keychainCommand, platformKey, rotationWarning } from '../../src/lib/secrets/platforms'
import { groupInventory, type SecretEntry } from '../../src/lib/secrets/inventory'

const place = (path: string, extra: Partial<SecretEntry['places'][number]> = {}) => ({ path, field: 'X', kind: 'env-file', tracked: false, everCommitted: false, ...extra })

describe('Settings → Keys platforms', () => {
  it('maps the scan platform and the variable name to where it is rotated', () => {
    expect(platformKey('ANTHROPIC_API_KEY', 'anthropic')).toBe('anthropic')
    expect(platformKey('GEMINI_API_KEY', 'google')).toBe('gemini')
    expect(platformKey('GOOGLE_CLIENT_SECRET', 'google')).toBe('google-oauth')
    expect(platformKey('GITHUB_TOKEN', 'github')).toBe('github-token')
    expect(platformKey('GITHUB_APP_PRIVATE_KEY', 'other')).toBe('github-app')
    expect(platformKey('GITHUB_CLIENT_SECRET', 'other')).toBe('github-app')
    expect(platformKey('SUPABASE_SERVICE_ROLE_KEY', 'supabase:service_role')).toBe('supabase')
    expect(platformKey('STRIPE_WEBHOOK_SECRET', 'stripe')).toBe('stripe')
    expect(platformKey('SLACK_SIGNING_SECRET', 'other')).toBe('slack')
    expect(platformKey('AUTH_SECRET', 'other')).toBe('self')
    expect(platformKey('CRON_SECRET', 'other')).toBe('self')
    expect(platformKey('DATABASE_URL', 'neon')).toBe('neon')
    expect(platformKey('DATABASE_URL', 'other')).toBe('postgres')
    expect(platformKey('gateway.auth.token', 'other')).toBe('openclaw')
    expect(platformKey('SOMETHING_ODD', 'other')).toBe('other')
  })
  it('every platform says how to rotate, and external links are https', () => {
    for (const p of Object.values(PLATFORMS)) {
      expect(p.how.length, p.key).toBeGreaterThan(10)
      if (p.rotateUrl) expect(p.rotateUrl, p.key).toMatch(/^https:\/\//)
    }
  })
  it('warns where rotating breaks something', () => {
    expect(rotationWarning('ENCRYPTION_KEY')).toMatch(/re-encrypt/)
    expect(rotationWarning('OPENAI_API_KEY')).toBeNull()
  })
  it('the keychain command copies, never prints, and quotes the service', () => {
    expect(keychainCommand("vault/repo/KEY")).toBe("security find-generic-password -s 'vault/repo/KEY' -w | pbcopy")
    expect(keychainCommand("a'b")).toBe("security find-generic-password -s 'a'\\''b' -w | pbcopy")
  })
})

describe('groupInventory', () => {
  const entries: SecretEntry[] = [
    { id: 'k1', name: 'GITHUB_TOKEN', platform: 'github', keychain: [], places: [place('~/r/portfolio/.env', { tracked: true, repo: 'portfolio', field: 'GITHUB_TOKEN' })] },
    { id: 'k2', name: 'OPENAI_API_KEY', platform: 'openai', keychain: ['vault/a/OPENAI_API_KEY'], places: [place('~/r/a/.env', { field: 'OPENAI_API_KEY' })] },
    { id: 'k3', name: 'LITELLM_MASTER_KEY', platform: 'litellm', keychain: ['litellm-master-key'], places: [place('~/ai-stack/litellm/.env', { field: 'LITELLM_MASTER_KEY' }), place('~/ai-stack/litellm/.env.bak-1', { kind: 'backup-file', field: 'LITELLM_MASTER_KEY' }), place('~/.openclaw/openclaw.json.bak.2', { kind: 'backup-file', field: 'x' })] },
  ]
  const cloud = { vercel: { projects: [{ project: 'site', envs: [{ name: 'OPENAI_API_KEY', targets: ['production'] }, { name: 'LITELLM_MASTER_KEY', targets: [] }] }] },
    github: { repos: [{ repo: 'old-tool', private: false, secrets: [], dependabot: [], leakAlerts: [{ type: 'Google API Key', url: 'https://github.com/x' }] }], checked: 1 } }

  it('groups by platform, flags problems and finds cloud copies by name', () => {
    const { groups, alerts } = groupInventory({ entries, cloud })
    const gh = groups.find(g => g.platform.key === 'github-token')!
    expect(gh.keys[0]!.problems).toEqual(['committed to git: ~/r/portfolio/.env', 'no keychain copy yet'])
    const openai = groups.find(g => g.platform.key === 'openai')!
    expect(openai.keys[0]!.problems).toEqual([])
    expect(openai.keys[0]!.cloud).toEqual(['Vercel: site'])
    // Local-only secrets never claim a cloud copy, even when a name matches.
    expect(groups.find(g => g.platform.key === 'litellm')!.keys[0]!.cloud).toEqual([])
    expect(groups[0]!.platform.key).toBe('github-token') // worst problem first
    // OpenClaw's own rotating backups don't count; a stray backup does, once.
    expect(groups.find(g => g.platform.key === 'litellm')!.keys[0]!.problems).toEqual(['1 backup file holds a copy'])
    expect(alerts.map(a => a.severity)).toEqual(['high', 'high', 'medium'])
    expect(alerts[1]!.text).toContain('public repo')
  })
})
