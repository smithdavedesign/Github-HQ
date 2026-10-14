/**
 * Settings → Keys (`/settings/keys`): the owner's secret inventory, as `~/ai-stack/bin/secrets sync` writes it.
 * Seeds one secret_inventory row (host 'e2e', newest, so the page shows it) and deletes it afterwards.
 */
import { test, expect } from '@playwright/test'
import { neon } from '@neondatabase/serverless'
import { DISPOSABLE_DB, DISPOSABLE_DB_REASON } from './helpers/disposable-db'
import { FACTORY_OWNER, NOT_FACTORY_OWNER } from './helpers/factory'

const sql = () => neon(process.env.DATABASE_URL ?? '')
const place = (path: string, extra: Record<string, unknown> = {}) => ({ path, field: 'X', kind: 'env-file', tracked: false, everCommitted: false, ...extra })
const entries = [
  { id: 'k1', name: 'GITHUB_TOKEN', platform: 'github', keychain: ['vault/portfolio/GITHUB_TOKEN'], places: [place('~/Repos/portfolio/.env', { field: 'GITHUB_TOKEN', tracked: true, repo: 'portfolio', line: 1 })] },
  { id: 'k2', name: 'OPENAI_API_KEY', platform: 'openai', keychain: ['vault/app/OPENAI_API_KEY'], places: [place('~/Repos/app/.env', { field: 'OPENAI_API_KEY' })] },
  { id: 'k3', name: 'OLD_DEPLOY_TOKEN', platform: 'vercel', keychain: [], revoked: true, places: [place('~/Repos/old/.env', { field: 'OLD_DEPLOY_TOKEN', tracked: true, repo: 'old' })] },
]
const hostChecks = [{ name: 'Disk encryption (FileVault)', ok: true, detail: 'FileVault is On.' }, { name: 'macOS updates', ok: false, detail: 'macOS Sequoia 15.8.1' }]
const cloud = { vercel: { projects: [{ project: 'app', envs: [{ name: 'OPENAI_API_KEY', targets: ['production'] }] }] }, github: { repos: [], checked: 3 }, gcp: { project: 'p', keys: [] }, neon: { projects: [] } }

async function cleanup() {
  await sql()`DELETE FROM secret_inventory WHERE host = 'e2e'`.catch(() => {})
}

test.describe('Settings → Keys', () => {
  test.beforeAll(async () => {
    if (!DISPOSABLE_DB || !FACTORY_OWNER) return
    await cleanup()
    await sql()`INSERT INTO secret_inventory (host, taken_at, entries, cloud, keychain, blocked, host_checks)
      VALUES ('e2e', NOW() + interval '1 minute', ${JSON.stringify(entries)}::jsonb, ${JSON.stringify(cloud)}::jsonb, '[]'::jsonb, '[]'::jsonb, ${JSON.stringify(hostChecks)}::jsonb)`
  })
  test.afterAll(cleanup)
  test.beforeEach(() => {
    test.skip(!DISPOSABLE_DB, DISPOSABLE_DB_REASON)
    test.skip(!FACTORY_OWNER, NOT_FACTORY_OWNER)
  })

  test('Settings links to Keys, which lists rotate links, keychain items and what to fix first', async ({ page }) => {
    await page.goto('/settings')
    await page.getByTestId('settings-keys-link').click()
    await expect(page).toHaveURL(/\/settings\/keys$/)
    await expect(page.getByRole('heading', { name: 'Keys' })).toBeVisible()
    await expect(page.getByTestId('key-alerts')).toContainText('GITHUB_TOKEN is committed to git in portfolio')

    const gh = page.getByTestId('key-platform-github-token')
    await expect(gh.getByRole('link', { name: /Rotate/ })).toHaveAttribute('href', 'https://github.com/settings/tokens')
    await expect(gh).toContainText('vault/portfolio/GITHUB_TOKEN')

    const openai = page.getByTestId('key-platform-openai')
    await expect(openai.getByRole('link', { name: /Rotate/ })).toHaveAttribute('href', 'https://platform.openai.com/api-keys')
    await openai.getByText(/Used in 1 place on the Mac and 1 in the cloud/).click()
    await expect(openai).toContainText('Vercel: app (same name)')

    // A revoked key: badge, no urgent alert even though it's still committed.
    await expect(page.getByTestId('key-platform-vercel')).toContainText('revoked')
    await expect(page.getByTestId('key-alerts')).not.toContainText('OLD_DEPLOY_TOKEN')
    // This Mac: protections and what needs doing.
    await expect(page.getByTestId('host-checks')).toContainText('FileVault is On.')
    await expect(page.getByTestId('host-checks')).toContainText('macOS Sequoia 15.8.1')
  })
})
