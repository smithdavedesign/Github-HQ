import type { DigestContent } from '@/lib/ai/digest'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Sparkles, AlertTriangle, ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { formatDistanceToNow } from '@/lib/utils'

interface WeeklyBriefingProps {
  digest: DigestContent
}

const urgencyStyles = {
  critical: 'bg-red-500/10 text-red-600 border-red-500/20',
  high: 'bg-amber-500/10 text-amber-600 border-amber-500/20',
  medium: 'bg-blue-500/10 text-blue-600 border-blue-500/20',
}

export function WeeklyBriefing({ digest }: WeeklyBriefingProps) {
  const generatedDate = new Date(digest.generatedAt)

  return (
    <Card className="border-violet-200 dark:border-violet-900 bg-gradient-to-br from-violet-50/50 to-transparent dark:from-violet-950/20">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-violet-500" />
            Weekly AI Briefing
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            {formatDistanceToNow(generatedDate)}
          </span>
        </div>
        <p className="text-sm text-muted-foreground mt-1">{digest.summary}</p>
      </CardHeader>

      <CardContent className="space-y-3">
        {digest.priorities.map((p) => (
          <div
            key={p.rank}
            className="flex gap-3 p-3 rounded-lg border bg-background/60 hover:bg-background transition-colors"
          >
            <div className="flex items-start gap-2 flex-1 min-w-0">
              <span className="text-xs font-bold text-muted-foreground w-4 shrink-0 mt-0.5">{p.rank}.</span>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium">{p.title}</p>
                  <Badge variant="outline" className={`text-xs ${urgencyStyles[p.urgency]}`}>
                    {p.urgency}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">{p.reason}</p>
                <div className="flex items-start gap-1 text-xs">
                  <ArrowRight className="w-3 h-3 text-violet-500 shrink-0 mt-0.5" />
                  <span className="text-foreground">{p.action}</span>
                </div>
              </div>
            </div>
            {p.repoId > 0 && (
              <Link
                href={`/repos/${p.repoId}`}
                className="text-xs text-violet-600 hover:text-violet-700 hover:underline shrink-0 mt-0.5"
              >
                {p.repoName} →
              </Link>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
