import { getRepositories } from '@/lib/actions/repositories'
import { RepoTable } from '@/components/repos/repo-table'

export default async function ReposPage() {
  const repos = await getRepositories()

  return (
    <div className="space-y-4 max-w-[1600px] mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Repositories</h1>
        <p className="text-muted-foreground text-sm mt-1">
          All {repos.length} repositories — sortable, filterable, exportable
        </p>
      </div>
      <RepoTable data={repos} />
    </div>
  )
}
