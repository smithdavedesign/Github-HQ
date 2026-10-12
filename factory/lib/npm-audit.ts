/**
 * npm's arborist sometimes crashes on an install tree it can't model (a stale or hand-edited
 * lockfile, an aborted install): `Cannot read properties of null (reading 'edgesOut')`. It's npm's
 * bug, not the repo's, and `npm audit fix --package-lock-only` usually gets past it because it
 * plans from the lockfile instead of the tree. 5 of the factory's M0 dependency fixes failed this
 * way on 2026-10-10 ("harness failed").
 */
const ARBORIST_CRASH = /Cannot read propert(?:y|ies) of (?:null|undefined) \(reading '(?:edgesOut|edgesIn|children|package|isProjectRoot)'\)/

export function isArboristCrash(output: string): boolean {
  return ARBORIST_CRASH.test(output)
}

/** The retry for a crashed `npm audit fix`: same flags, lockfile-only. */
export function lockfileOnlyRetryArgs(args: string[]): string[] | null {
  if (args[0] !== 'audit' || args[1] !== 'fix' || args.includes('--package-lock-only')) return null
  return [...args, '--package-lock-only']
}
