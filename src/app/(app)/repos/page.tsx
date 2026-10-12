import { getRepositories, getOpenAgentPRsByRepo } from '@/lib/actions/repositories'
import { ReposClient } from '@/components/repos/repos-client'
import type { Metadata } from 'next'

export const metadata: Metadata = { title: 'Repositories' }

export default async function ReposPage() {
  const [repos, openAgentPRs] = await Promise.all([
    getRepositories(),
    getOpenAgentPRsByRepo(),
  ])
  return <ReposClient repos={repos} openAgentPRs={openAgentPRs} />
}
