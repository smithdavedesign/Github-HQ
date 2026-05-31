'use client'

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface WeekData {
  week: number  // Unix timestamp
  total: number
}

export function CommitActivityChart({ data }: { data: WeekData[] }) {
  const chartData = data.map((d) => ({
    label: new Date(d.week * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    commits: d.total,
  }))

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">Commit Activity (13 weeks)</CardTitle>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={140}>
          <BarChart data={chartData} margin={{ left: -20, right: 8 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={2} />
            <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
            <Tooltip
              formatter={(v) => [`${v} commits`, '']}
              contentStyle={{ fontSize: 12 }}
            />
            <Bar dataKey="commits" fill="#3b82f6" radius={[2, 2, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
