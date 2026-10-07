/**
 * Who may sign in. RepoHQ is a personal tool (decided 2026-10-07): sign-in is limited to the GitHub
 * logins in ALLOWED_GITHUB_LOGINS (comma-separated, case-insensitive). Unset keeps sign-in open,
 * for local development and fresh deployments; production sets it.
 *
 * Pure: src/lib/auth.ts calls it from the signIn callback.
 */
export function isAllowedGithubLogin(login: string | null | undefined, allowed: string | undefined): boolean {
  const list = (allowed ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  if (list.length === 0) return true
  return !!login && list.includes(login.toLowerCase())
}
