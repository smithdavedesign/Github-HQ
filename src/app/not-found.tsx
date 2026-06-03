import Link from 'next/link'
import { GitBranch } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-6 text-center px-6">
      <div className="w-12 h-12 rounded-xl bg-indigo-600 flex items-center justify-center shadow-sm">
        <GitBranch className="w-6 h-6 text-white" />
      </div>
      <div>
        <p className="text-4xl font-bold tabular-nums text-muted-foreground/40">404</p>
        <p className="text-lg font-semibold mt-2">Page not found</p>
        <p className="text-sm text-muted-foreground mt-1 max-w-sm">
          This page doesn't exist or you don't have access to it.
        </p>
      </div>
      <div className="flex gap-2">
        <Button asChild size="sm">
          <Link href="/">Go to Dashboard</Link>
        </Button>
        <Button asChild size="sm" variant="outline">
          <Link href="/repos">View Repositories</Link>
        </Button>
      </div>
    </div>
  )
}
