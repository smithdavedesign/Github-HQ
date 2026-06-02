import { getRepositories, getOpenAgentPRsByRepo } from '@/lib/actions/repositories'
import { ReposClient } from '@/components/repos/repos-client'

export default async function ReposPage() {
  const [repos, openAgentPRs] = await Promise.all([
    getRepositories(),
    getOpenAgentPRsByRepo(),
  ])
  return <ReposClient repos={repos} openAgentPRs={openAgentPRs} />
}
