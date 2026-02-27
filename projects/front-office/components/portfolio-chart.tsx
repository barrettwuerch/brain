'use client'

import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

export function PortfolioChart({ data }: { data: Array<{ date: string; value: number }> }) {
  return (
    <div className="h-full w-full rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
      <div className="text-xs text-zinc-400">Portfolio (synthetic)</div>
      <div className="mt-2 h-[calc(100%-1.5rem)]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 10, left: 10, right: 10, bottom: 0 }}>
            <XAxis dataKey="date" hide />
            <YAxis hide />
            <Tooltip
              contentStyle={{ background: '#09090b', border: '1px solid #27272a' }}
              labelFormatter={(l) => `Date: ${l}`}
              formatter={(v: any) => [`$${Number(v).toFixed(2)}`, 'Value']}
            />
            <Line type="monotone" dataKey="value" stroke="#10b981" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
