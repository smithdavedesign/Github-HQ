/**
 * npm's arborist sometimes crashes on an install tree it can't model (a stale or hand-edited
 * lockfile, an aborted install): `Cannot read properties of null (reading 'edgesOut')`. It's npm's
 * bug, not the repo's, and `npm audit fix --package-lock-only` usually gets past it because it
 * plans from the lockfile instead of the tree. 5 of the factory's M0 dependency fixes failed this
 * way on 2026-10-10 ("harness failed").
 */
const ARBORIST_CRASH = /Cannot read propert(?:y|ies) of (?:null|undefined) \(reading '(?:edgesOut|edgesIn|children|package|isProjectRoot)'\)/

/**
 * Where `npm audit fix` runs (pure): the root with an install (never --force), and each sub-package
 * lockfile-only, so nothing is installed or run there. A security fix request does both; a sensed
 * deps-audit does the root, or the sub-packages of a repo with no root package.json.
 */
export function auditFixTargets(wsDir: string, subDirs: string[], root: boolean): { cwd: string; args: string[]; label: string }[] {
  return [
    ...(root ? [{ cwd: wsDir, args: ['audit', 'fix', '--no-fund'], label: subDirs.length ? '(root)' : '' }] : []),
    ...subDirs.map(d => ({ cwd: `${wsDir.replace(/\/$/, '')}/${d}`, args: ['audit', 'fix', '--package-lock-only', '--no-fund'], label: d })),
  ]
}

export function isArboristCrash(output: string): boolean {
  return ARBORIST_CRASH.test(output)
}

/** The retry for a crashed `npm audit fix`: same flags, lockfile-only. */
export function lockfileOnlyRetryArgs(args: string[]): string[] | null {
  if (args[0] !== 'audit' || args[1] !== 'fix' || args.includes('--package-lock-only')) return null
  return [...args, '--package-lock-only']
}

/**
 * `npm audit fix` without --force can only apply in-range upgrades. When every advisory left needs
 * --force (a semver-major or out-of-range bump, e.g. Open-Travel's next@16.4.0 on 2026-10-12), it
 * fixes nothing and exits 1. That's not a broken harness: it's a task M0 can't do by design.
 * @returns the reason to record, or null when the output doesn't look like that
 */
export function onlyForceFixes(output: string): string | null {
  if (/fixed [1-9]\d* of \d+/i.test(output)) return null
  if (!/fix available via `npm audit fix --force`/.test(output)) return null
  const bumps = [...new Set([...output.matchAll(/Will install (\S+@\S+), which is (?:a breaking change|outside the stated dependency range)/g)].map(m => m[1]))]
  return `no non-breaking fix: every remaining advisory needs \`npm audit fix --force\`${bumps.length ? ` (${bumps.slice(0, 3).join(', ')})` : ''}, which the factory never runs; needs a major upgrade`
}
