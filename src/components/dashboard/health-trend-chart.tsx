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
  security: number
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
        <ResponsiveContainer width="100%" height={400}>
          <BarChart data={data} layout="vertical" margin={{ left: 100, right: 20 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11 }} />
            <YAxis
              type="category"
              dataKey="name"
              tick={{ fontSize: 11 }}
              width={96}
            />
            <Tooltip
              formatter={(value) => [`${value}`, '']}
              contentStyle={{ fontSize: 12 }}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="health" name="Health" fill="#10b981" radius={[0, 2, 2, 0]} barSize={8} />
            <Bar dataKey="security" name="Security" fill="#3b82f6" radius={[0, 2, 2, 0]} barSize={8} />
            <Bar dataKey="activity" name="Activity" fill="#f59e0b" radius={[0, 2, 2, 0]} barSize={8} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
