import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Bot, GitPullRequest, ExternalLink } from 'lucide-react'
import Link from 'next/link'

interface ActiveAgent {
  repoName: string
  stage: string
  taskId: string
  prUrl?: string
  occurredAt: Date
}

interface ActiveAgentsCardProps {
  agents: ActiveAgent[]
}

export function ActiveAgentsCard({ agents }: ActiveAgentsCardProps) {
  if (agents.length === 0) return null

  return (
    <Card className="card-elevated border-indigo-200/50 bg-indigo-50/30 dark:bg-indigo-950/20 dark:border-indigo-800/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Bot className="w-4 h-4 text-indigo-500 animate-pulse" />
          {agents.length} agent{agents.length !== 1 ? 's' : ''} running
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-1.5">
        {agents.map((a, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <Link href={`/repos?q=${encodeURIComponent(a.repoName)}#agent-history`} className="font-medium hover:underline truncate flex-1">
              {a.repoName}
            </Link>
            {a.stage === 'pr_ready' && a.prUrl ? (
              <a href={a.prUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-0.5 text-[10px] text-emerald-600 hover:underline shrink-0">
                <GitPullRequest className="w-2.5 h-2.5" />PR open<ExternalLink className="w-2 h-2" />
              </a>
            ) : (
              <Badge variant="outline" className="text-[9px] h-4 px-1.5 bg-indigo-50 text-indigo-600 border-indigo-200 shrink-0">
                {a.stage === 'queued' ? 'Queued…' : a.stage}
              </Badge>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
