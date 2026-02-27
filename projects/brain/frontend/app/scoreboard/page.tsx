'use client'

import { StatBlock } from '@/components/stat-block'
import { PortfolioChart } from '@/components/portfolio-chart'
import { usePrices } from '@/hooks/use-prices'
import { useStrategyOutcomes } from '@/hooks/use-strategy-outcomes'
import { useEffect, useMemo, useState } from 'react'

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

  const [trades, setTrades] = useState<any[]>([])

  useEffect(() => {
    const fetchTrades = async () => {
      const res = await fetch('/api/trades', { cache: 'no-store' })
      if (res.ok) {
        const data = await res.json()
        setTrades(data.trades ?? [])
      }
    }
    fetchTrades()
    const iv = setInterval(fetchTrades, 30000)
    return () => clearInterval(iv)
  }, [])

  const equity = Number(prices?.equity ?? 5000)
  const positions = Array.isArray(prices?.positions) ? prices?.positions : []

  const deployedCapital = useMemo(() => {
    // Alpaca positions include market_value as string; sum absolute values.
    const mv = positions
      .map((p: any) => Math.abs(Number(p.market_value ?? 0)))
      .filter((n: number) => Number.isFinite(n))
      .reduce((s: number, n: number) => s + n, 0)
    return mv
  }, [positions])

  const availableCapital = Math.max(0, equity - deployedCapital)

  // Synthetic chart placeholder: until we have a dedicated equity history series.
  const chart = (outcomes ?? []).slice(0, 30).map((o: any, i: number) => ({
    date: String(o.created_at ?? i),
    value: equity,
  }))

  const tradesCount = trades.length

  return (
    <div>
      <h1 className="text-xl font-semibold">Scoreboard</h1>

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatBlock label="Total Capital" value={formatMoney(equity)} />
        <StatBlock label="Available Capital" value={formatMoney(availableCapital)} />
        <StatBlock label="Open Positions" value={String(positions.length)} />
        <StatBlock label="Trades" value={String(tradesCount)} />
      </div>

      <div className="mt-6">
        <div className="h-48 md:h-64 w-full">
          <PortfolioChart data={chart} />
        </div>
      </div>

      <div className="mt-6 rounded-xl border border-zinc-800 bg-zinc-900/40 p-4">
        <div className="text-sm font-medium">Recent strategy outcomes</div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
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

      {/* Trade History */}
      <div className="mt-6 rounded-lg border border-zinc-800 bg-zinc-900/50 overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-800">
          <h2 className="text-sm font-semibold text-white">Trade History</h2>
          <p className="text-xs text-zinc-500 mt-0.5">Actual executed orders from Alpaca paper + Kalshi demo</p>
        </div>

        {trades.length === 0 ? (
          <div className="px-5 py-10 text-center">
            <div className="text-zinc-400 text-sm font-medium">No trades yet</div>
            <div className="text-zinc-600 text-xs mt-1 max-w-sm mx-auto">
              Trades appear here once the Brain executes its first order. The pipeline needs to flow: Scanner → Research → Strategy → Execution.
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px] text-sm">
              <thead>
                <tr className="border-b border-zinc-800 text-xs text-zinc-500 uppercase tracking-wider">
                  <th className="px-5 py-3 text-left">Date</th>
                  <th className="px-5 py-3 text-left">Symbol</th>
                  <th className="px-5 py-3 text-left">Desk</th>
                  <th className="px-5 py-3 text-left">Side</th>
                  <th className="px-5 py-3 text-right">Qty</th>
                  <th className="px-5 py-3 text-right">Entry</th>
                  <th className="px-5 py-3 text-right">Exit</th>
                  <th className="px-5 py-3 text-right">P&L</th>
                  <th className="px-5 py-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {trades.map((trade: any, i: number) => {
                  const pnlColor =
                    trade.pnl == null
                      ? 'text-zinc-500'
                      : trade.pnl > 0
                        ? 'text-green-400'
                        : trade.pnl < 0
                          ? 'text-red-400'
                          : 'text-zinc-400'
                  const sideColor = String(trade.side) === 'buy' ? 'text-blue-400' : 'text-orange-400'
                  const statusColor =
                    trade.status === 'open'
                      ? 'text-yellow-400'
                      : trade.status === 'filled' || trade.status === 'closed'
                        ? 'text-green-400'
                        : 'text-zinc-400'

                  const opened = new Date(trade.opened_at)

                  return (
                    <tr key={trade.id ?? i} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                      <td className="px-5 py-3 text-zinc-400 text-xs">
                        {opened.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' })}{' '}
                        {opened.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })}
                      </td>
                      <td className="px-5 py-3 font-mono text-white font-medium text-xs">{trade.symbol ?? '—'}</td>
                      <td className="px-5 py-3 text-zinc-400 text-xs capitalize">{trade.desk ?? '—'}</td>
                      <td className={`px-5 py-3 text-xs font-bold uppercase ${sideColor}`}>{trade.side ?? '—'}</td>
                      <td className="px-5 py-3 text-right text-zinc-300 text-xs">{trade.qty ?? '—'}</td>
                      <td className="px-5 py-3 text-right text-zinc-300 text-xs font-mono">
                        {trade.entry_price != null ? `$${Number(trade.entry_price).toFixed(2)}` : '—'}
                      </td>
                      <td className="px-5 py-3 text-right text-zinc-300 text-xs font-mono">
                        {trade.exit_price != null ? `$${Number(trade.exit_price).toFixed(2)}` : '—'}
                      </td>
                      <td className={`px-5 py-3 text-right text-xs font-mono font-bold ${pnlColor}`}>
                        {trade.pnl != null ? `${trade.pnl >= 0 ? '+' : ''}$${Math.abs(Number(trade.pnl)).toFixed(2)}` : '—'}
                      </td>
                      <td className={`px-5 py-3 text-center text-xs font-medium capitalize ${statusColor}`}>{trade.status ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
