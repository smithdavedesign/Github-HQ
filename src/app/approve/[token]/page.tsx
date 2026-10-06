import Link from 'next/link'
import { redirect } from 'next/navigation'

import { consumeApprovalToken, verifyApprovalToken } from '@/lib/approval-tokens'

async function approveAction(formData: FormData) {
  'use server'

  const token = String(formData.get('token') ?? '')
  if (!token) {
    redirect('/approve/invalid?error=missing-token')
  }

  try {
    const payload = consumeApprovalToken(token)
    redirect(`/approve/${encodeURIComponent(token)}?approved=1&taskId=${encodeURIComponent(payload.taskId)}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Approval failed'
    redirect(`/approve/${encodeURIComponent(token)}?error=${encodeURIComponent(message)}`)
  }
}

export default async function ApprovalPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>
  searchParams: Promise<{ approved?: string; error?: string; taskId?: string }>
}) {
  const { token } = await params
  const query = await searchParams
  const approved = query.approved === '1'

  if (approved) {
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-12">
        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/5 p-6 shadow-sm">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-emerald-600">Approval accepted</p>
          <h1 className="mt-4 text-2xl font-bold text-foreground">The action is approved.</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            Task {query.taskId ? <span className="font-medium text-foreground">{query.taskId}</span> : 'requested'} has been cleared for the next step.
          </p>
          <Link href="/" className="mt-6 inline-flex items-center text-sm font-medium text-foreground underline underline-offset-4">
            Return to dashboard
          </Link>
        </div>
      </main>
    )
  }

  let payload
  try {
    payload = verifyApprovalToken(token)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Approval token is invalid'
    return (
      <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-12">
        <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-6 shadow-sm">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-red-600">Approval unavailable</p>
          <h1 className="mt-4 text-2xl font-bold text-foreground">This approval link is no longer valid.</h1>
          <p className="mt-3 text-sm text-muted-foreground">{message}</p>
          {query.error && (
            <p className="mt-2 text-xs text-red-700">Details: {decodeURIComponent(query.error)}</p>
          )}
          <Link href="/" className="mt-6 inline-flex items-center text-sm font-medium text-foreground underline underline-offset-4">
            Return to dashboard
          </Link>
        </div>
      </main>
    )
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-12">
      <div className="rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
        <p className="text-sm font-medium uppercase tracking-[0.18em] text-muted-foreground">Approval required</p>
        <h1 className="mt-4 text-2xl font-bold text-foreground">Approve this action</h1>

        <div className="mt-5 space-y-3 rounded-xl border border-border/60 bg-muted/20 p-4 text-sm text-muted-foreground">
          <div className="flex items-center justify-between gap-3">
            <span>Task</span>
            <span className="font-medium text-foreground">{payload.taskId}</span>
          </div>
          {payload.repo && (
            <div className="flex items-center justify-between gap-3">
              <span>Repository</span>
              <span className="font-medium text-foreground">{payload.repo}</span>
            </div>
          )}
          <div className="flex items-center justify-between gap-3">
            <span>Action</span>
            <span className="font-medium text-foreground">{payload.action}</span>
          </div>
          {payload.reason && (
            <div>
              <div className="mb-1">Reason</div>
              <div className="font-medium text-foreground">{payload.reason}</div>
            </div>
          )}
        </div>

        <form action={approveAction} className="mt-6">
          <input type="hidden" name="token" value={token} />
          <button
            type="submit"
            className="inline-flex items-center justify-center rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:opacity-90"
          >
            Approve request
          </button>
        </form>
      </div>
    </main>
  )
}
