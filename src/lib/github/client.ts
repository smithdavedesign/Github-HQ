import { Octokit } from '@octokit/rest'

export function createOctokit(token: string): Octokit {
  return new Octokit({ auth: token })
}

export type OctokitClient = Octokit

/** The HTTP status of an Octokit error, if it has one. */
export function httpStatus(err: unknown): number | null {
  const status = (err as { status?: unknown } | null)?.status
  return typeof status === 'number' ? status : null
}
