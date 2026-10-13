'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Factory, Loader2 } from 'lucide-react'
import { openFactoryOnRepo } from '@/lib/actions/agent-queue'

/** Where the owner grants the factory's GitHub App access to a repo (GitHub only lets the owner do that). */
const FACTORY_APP_SETTINGS = 'https://github.com/settings/installations'

/**
 * "Let the factory work on this repo" (the factory's owner only): the repo joins the allowlist the factory
 * reads each cycle, and the Fix-it button appears. The factory's GitHub App still needs access to it.
 */
export function OpenFactoryButton({ repoId, repoName }: { repoId: number; repoName: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  async function open() {
    setBusy(true)
    try {
      const { fullName } = await openFactoryOnRepo(repoId)
      toast.success(`The factory can work on ${fullName} now`, {
        description: "If it isn't one of its repos on GitHub yet, give the factory's GitHub App access: Settings → Applications → repohq-factory → Configure → Repository access.",
        action: { label: 'Open GitHub', onClick: () => window.open(FACTORY_APP_SETTINGS, '_blank', 'noopener,noreferrer') },
        duration: 15_000,
      })
      router.refresh()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't open the repo to the factory")
    } finally {
      setBusy(false)
    }
  }

  return (
    <button
      onClick={open}
      disabled={busy}
      title={`Add ${repoName} to the repos the factory works on, so you can say "fix it"`}
      className="flex items-center gap-1 h-6 px-2 text-[10px] font-medium rounded border border-slate-300 text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-300 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
    >
      {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Factory className="w-3 h-3" />}
      {busy ? 'Opening…' : 'Let the factory work on this repo'}
    </button>
  )
}
