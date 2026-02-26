'use client'

import { StatBlock } from '@/components/stat-block'
import { PortfolioChart } from '@/components/portfolio-chart'
import { usePrices } from '@/hooks/use-prices'
import { useStrategyOutcomes } from '@/hooks/use-strategy-outcomes'

function formatMoney(x: number) {
  return `$${x.toFixed(2)}`
}

export default function ScoreboardPage() {
  const { data: prices } = usePrices()
  const { data: outcomes } = useStrategyOutcomes()

  const equity = Number(prices?.equity ?? 0)
  const positions = Array.isArray(prices?.positions) ? prices?.positions : []

  // Synthetic chart placeholder: until we have a dedicated equity history series.
  const chart = (outcomes ?? []).slice(0, 30).map((o: any, i: number) => ({
    date: String(o.created_at ?? i),
    value: equity,
  }))

  return (
    <div>
      <h1 className="text-xl font-semibold">Scoreboard</h1>

      <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatBlock label="Total Capital" value={formatMoney(equity)} />
        <StatBlock label="Buying Power" value={formatMoney(Number(prices?.buying_power ?? 0))} />
        <StatBlock label="Open Positions" value={String(positions.length)} />
        <StatBlock label="Outcome Rows" value={String((outcomes ?? []).length)} />
      </div>

      <div className="mt-6">
        <PortfolioChart data={chart} />
      </div>

      <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="text-sm font-medium">Recent strategy outcomes</div>
        <div className="mt-3 overflow-auto">
          <table className="min-w-full text-sm">
            <thead className="text-zinc-400">
              <tr>
                <th className="text-left p-2">created_at</th>
                <th className="text-left p-2">status</th>
                <th className="text-left p-2">total_trades</th>
                <th className="text-left p-2">total_pnl</th>
              </tr>
            </thead>
            <tbody>
              {(outcomes ?? []).slice(0, 20).map((o: any) => (
                <tr key={o.id} className="border-t border-zinc-800">
                  <td className="p-2 text-zinc-300">{String(o.created_at)}</td>
                  <td className="p-2">{String(o.status ?? '')}</td>
                  <td className="p-2">{String(o.total_trades ?? '')}</td>
                  <td className="p-2">{String(o.total_pnl ?? '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
