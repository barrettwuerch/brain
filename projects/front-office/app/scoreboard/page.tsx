'use client'

import { StatBlock } from '@/components/stat-block'
import { PortfolioChart } from '@/components/portfolio-chart'
import { usePrices } from '@/hooks/use-prices'
import { useStrategyOutcomes } from '@/hooks/use-strategy-outcomes'

function formatMoney(x: number) {
  return `$${x.toFixed(2)}`
}

function formatDate(iso: string) {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return iso
  return d.toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function cap1(s: string) {
  if (!s) return s
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function statusStyle(statusRaw: string) {
  const s = statusRaw.toLowerCase()
  if (s === 'approved') return 'text-emerald-300'
  if (s === 'sufficient') return 'text-amber-300'
  if (s === 'underperforming') return 'text-rose-300'
  return 'text-zinc-300'
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
        <StatBlock label="Trades" value={String((outcomes ?? []).reduce((s: number, o: any) => s + Number(o.total_trades ?? 0), 0))} />
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
                <th className="text-left p-2">Date</th>
                <th className="text-left p-2">Status</th>
                <th className="text-left p-2">Trades</th>
                <th className="text-left p-2">P&amp;L</th>
              </tr>
            </thead>
            <tbody>
              {(outcomes ?? []).slice(0, 20).map((o: any) => {
                const statusRaw = String(o.status ?? '')
                const pnl = Number(o.total_pnl ?? 0)
                return (
                  <tr key={o.id} className="border-t border-zinc-800">
                    <td className="p-2 text-zinc-300">{formatDate(String(o.created_at))}</td>
                    <td className={"p-2 " + statusStyle(statusRaw)}>{cap1(statusRaw)}</td>
                    <td className="p-2">{Number(o.total_trades ?? 0)}</td>
                    <td className={"p-2 " + (pnl >= 0 ? 'text-emerald-300' : 'text-rose-300')}>
                      {formatMoney(pnl)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
