'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts'
import type { HealthTrendPoint } from '@/lib/health/history'
import { TrendingUp } from 'lucide-react'

interface Props {
  data: HealthTrendPoint[]
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function HealthTrendLineChart({ data }: Props) {
  return (
    <Card className="card-elevated">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-muted-foreground" />
          <CardTitle className="text-sm font-semibold">Portfolio Health Trend</CardTitle>
        </div>
        <p className="text-xs text-muted-foreground">
          Daily average across all active repos — last 30 days
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        {data.length < 3 ? (
          <div className="flex items-center justify-center h-48 text-center">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Collecting data</p>
              <p className="text-xs text-muted-foreground mt-1">
                {data.length} of 3+ snapshots needed — check back after a few more syncs
              </p>
            </div>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
              <XAxis
                dataKey="date"
                tickFormatter={formatDate}
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                domain={[0, 100]}
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(value: any, name: any) => [
                  typeof value === 'number' ? value.toFixed(1) : value,
                  name === 'avgHealth' ? 'Health' : name === 'avgSecurity' ? 'Security' : 'Activity',
                ]}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                labelFormatter={(label: any) => typeof label === 'string' ? formatDate(label) : String(label)}
                contentStyle={{ fontSize: 12 }}
              />
              <Legend
                formatter={v => v === 'avgHealth' ? 'Health' : v === 'avgSecurity' ? 'Security' : 'Activity'}
                iconSize={8}
                wrapperStyle={{ fontSize: 11 }}
              />
              <Line
                type="monotone"
                dataKey="avgHealth"
                stroke="oklch(0.514 0.222 268)"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4 }}
              />
              <Line
                type="monotone"
                dataKey="avgSecurity"
                stroke="#ef4444"
                strokeWidth={1.5}
                dot={false}
                strokeDasharray="4 2"
                activeDot={{ r: 3 }}
              />
              <Line
                type="monotone"
                dataKey="avgActivity"
                stroke="#f59e0b"
                strokeWidth={1.5}
                dot={false}
                strokeDasharray="4 2"
                activeDot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  )
}
