'use client'

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  CartesianGrid,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface ChartDataPoint {
  name: string
  health: number
  activity: number
  /** null = unknown (Dependabot alerts off): no bar. */
  security: number | null
}

export function HealthTrendChart({ data }: { data: ChartDataPoint[] }) {
  if (data.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No data yet. Sync your repositories to see analytics.
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Repository Health Scores (Top 20)</CardTitle>
      </CardHeader>
      <CardContent>
        {/* 30px per repo so every name gets a label (at a fixed 400px Recharts skipped every other one). */}
        <ResponsiveContainer width="100%" height={Math.max(240, data.length * 30 + 60)}>
          <BarChart data={data} layout="vertical" margin={{ left: 8, right: 20 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 11 }}
              width={150}
              interval={0}
              tickFormatter={(name: string) => (name.length > 22 ? `${name.slice(0, 21)}…` : name)}
            />
            <Tooltip
              formatter={(value, name) => [value == null && name === 'Security' ? 'no data (Dependabot alerts off)' : `${value}`, '']}
              contentStyle={{ fontSize: 12 }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="health" name="Health" fill="#10b981" radius={[0, 2, 2, 0]} barSize={8} />
            <Bar dataKey="security" name="Security" fill="#3b82f6" radius={[0, 2, 2, 0]} barSize={8} />
            <Bar dataKey="activity" name="Activity" fill="#f59e0b" radius={[0, 2, 2, 0]} barSize={8} />
          </BarChart>
        </ResponsiveContainer>
        {data.some(d => d.security == null) && (
          <p className="text-xs text-muted-foreground mt-2">
            No blue bar: Dependabot alerts are off for that repo, so its security is unknown and left out of its health score.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
