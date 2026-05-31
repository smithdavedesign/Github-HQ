import { getRepositories } from '@/lib/actions/repositories'
import { ReposClient } from '@/components/repos/repos-client'

export default async function ReposPage() {
  const repos = await getRepositories()
  return <ReposClient repos={repos} />
}
