'use client'

import { usePrices } from '@/hooks/use-prices'
import { useStrategyOutcomes } from '@/hooks/use-strategy-outcomes'
import { useEffect, useMemo, useState } from 'react'

function fmt$(x: number, decimals = 2) {
  return `$${Math.abs(x).toLocaleString('en', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
}

function fmtDate(iso: string) {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' }) + ' ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function cap1(s: string) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

function StatCard({ label, value, sub, color = '#00f0ff' }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ background: 'rgba(0,10,30,0.8)', border: `1px solid ${color}33`, borderRadius: 8, padding: '14px 18px', fontFamily: "'Courier New', monospace" }}>
      <div style={{ fontSize: 9, letterSpacing: 2, color: color + '99', textTransform: 'uppercase', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 'bold', color, textShadow: `0 0 16px ${color}66`, letterSpacing: -0.5 }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>{sub}</div>}
    </div>
  )
}

export default function ScoreboardPage() {
  const { data: prices } = usePrices()
  const { data: outcomes } = useStrategyOutcomes()
  const [trades, setTrades] = useState<any[]>([])
  const [time, setTime] = useState('')

  useEffect(() => {
    const fetchTrades = async () => {
      const res = await fetch('/api/trades', { cache: 'no-store' })
      if (res.ok) { const d = await res.json(); setTrades(d.trades ?? []) }
    }
    fetchTrades()
    const iv = setInterval(fetchTrades, 30000)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    const t = setInterval(() => setTime(new Date().toLocaleTimeString()), 1000)
    return () => clearInterval(t)
  }, [])

  const equity = Number(prices?.equity ?? 5000)
  const positions = useMemo(() => Array.isArray(prices?.positions) ? prices.positions : [], [prices])

  const deployedCapital = useMemo(() =>
    positions.map((p: any) => Math.abs(Number(p.market_value ?? 0))).filter(Number.isFinite).reduce((s: number, n: number) => s + n, 0)
  , [positions])

  const availableCapital = Math.max(0, equity - deployedCapital)
  const closedTrades = trades.filter(t => t.status === 'closed' || t.status === 'filled')
  const totalPnl = closedTrades.reduce((s, t) => s + Number(t.pnl ?? 0), 0)
  const wins = closedTrades.filter(t => Number(t.pnl ?? 0) > 0).length
  const winRate = closedTrades.length ? (wins / closedTrades.length) * 100 : 0

  const BG = '#07090f'
  const BORDER = 'rgba(0,240,255,0.08)'
  const FONT = "'Courier New', monospace"

  return (
    <div style={{ background: BG, minHeight: '100vh', padding: '24px', fontFamily: FONT, color: '#e2e8f0' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 9, letterSpacing: 3, color: '#64748b', textTransform: 'uppercase', marginBottom: 4 }}>The Brain</div>
          <div style={{ fontSize: 20, fontWeight: 'bold', color: '#e2e8f0', letterSpacing: 1 }}>Scoreboard</div>
        </div>
        <div style={{ fontSize: 10, color: '#64748b', letterSpacing: 1 }}>{time}</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 28 }}>
        <StatCard label="Total Capital" value={fmt$(equity)} color="#00f0ff" />
        <StatCard label="Available" value={fmt$(availableCapital)} color="#00f0ff" sub={`${((availableCapital / equity) * 100).toFixed(1)}% idle`} />
        <StatCard label="Net P&L" value={`${totalPnl >= 0 ? '+' : '-'}${fmt$(totalPnl)}`} color={totalPnl >= 0 ? '#00ff9f' : '#ff3c6e'} />
        <StatCard label="Win Rate" value={`${winRate.toFixed(1)}%`} color={winRate >= 55 ? '#00ff9f' : '#ffe600'} sub={`${wins}W / ${closedTrades.length - wins}L`} />
      </div>

      {positions.length > 0 && (
        <div style={{ marginBottom: 28, border: `1px solid rgba(251,191,36,0.2)`, borderRadius: 8, overflow: 'hidden', background: 'rgba(0,10,30,0.6)' }}>
          <div style={{ padding: '12px 20px', borderBottom: `1px solid rgba(251,191,36,0.12)`, display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fbbf24', boxShadow: '0 0 8px #fbbf24', display: 'inline-block' }} />
            <span style={{ fontSize: 11, fontWeight: 'bold', color: '#fbbf24', letterSpacing: 2, textTransform: 'uppercase' }}>Open Positions</span>
            <span style={{ marginLeft: 'auto', fontSize: 9, color: '#64748b' }}>{positions.length} active</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                  {['Symbol', 'Qty', 'Avg Entry', 'Market Value', 'Unrealized P&L', 'Change%'].map((h, i) => (
                    <th key={h} style={{ padding: '8px 16px', textAlign: i === 0 ? 'left' : 'right', fontSize: 9, letterSpacing: 1.5, color: '#64748b', textTransform: 'uppercase', fontWeight: 'normal' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {positions.map((p: any, i: number) => {
                  const upnl = Number(p.unrealized_pl ?? 0)
                  const pct = Number(p.unrealized_plpc ?? 0) * 100
                  const color = upnl >= 0 ? '#00ff9f' : '#ff3c6e'
                  return (
                    <tr key={i} style={{ borderBottom: `1px solid ${BORDER}` }}>
                      <td style={{ padding: '10px 16px', color: '#fff', fontWeight: 'bold' }}>{p.symbol}</td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', color: '#94a3b8' }}>{Number(p.qty).toFixed(4)}</td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', color: '#94a3b8' }}>{fmt$(Number(p.avg_entry_price ?? 0))}</td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', color: '#e2e8f0' }}>{fmt$(Number(p.market_value ?? 0))}</td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', color, fontWeight: 'bold' }}>{upnl >= 0 ? '+' : '-'}{fmt$(upnl)}</td>
                      <td style={{ padding: '10px 16px', textAlign: 'right', color, fontSize: 10 }}>{upnl >= 0 ? '+' : ''}{pct.toFixed(2)}%</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div style={{ marginBottom: 28, border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden', background: 'rgba(0,10,30,0.6)' }}>
        <div style={{ padding: '12px 20px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#00f0ff', boxShadow: '0 0 8px #00f0ff', display: 'inline-block' }} />
          <span style={{ fontSize: 11, fontWeight: 'bold', color: '#00f0ff', letterSpacing: 2, textTransform: 'uppercase' }}>Trade History</span>
          <span style={{ marginLeft: 'auto', fontSize: 9, color: '#64748b' }}>Alpaca paper + Kalshi demo</span>
        </div>
        {trades.length === 0 ? (
          <div style={{ padding: '48px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: 13, color: '#64748b' }}>No trades yet</div>
            <div style={{ fontSize: 10, color: '#475569', marginTop: 6 }}>Scanner to Risk to Execution pipeline running</div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                  {['Date', 'Symbol', 'Desk', 'Side', 'Qty', 'Entry', 'Exit', 'P&L', 'Status'].map((h, i) => (
                    <th key={h} style={{ padding: '8px 14px', textAlign: i >= 4 ? 'right' : 'left', fontSize: 9, letterSpacing: 1.5, color: '#64748b', textTransform: 'uppercase', fontWeight: 'normal' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {trades.map((t: any, i: number) => {
                  const pnl = t.pnl != null ? Number(t.pnl) : null
                  const pnlColor = pnl == null ? '#94a3b8' : pnl > 0 ? '#00ff9f' : pnl < 0 ? '#ff3c6e' : '#64748b'
                  const sideColor = String(t.side) === 'buy' ? '#60a5fa' : '#fb923c'
                  const statusColor = t.status === 'open' ? '#fbbf24' : (t.status === 'filled' || t.status === 'closed') ? '#00ff9f' : '#94a3b8'
                  return (
                    <tr key={t.id ?? i} style={{ borderBottom: `1px solid rgba(255,255,255,0.03)` }}>
                      <td style={{ padding: '10px 14px', color: '#94a3b8', fontSize: 10 }}>{fmtDate(t.opened_at)}</td>
                      <td style={{ padding: '10px 14px', color: '#fff', fontWeight: 'bold' }}>{t.symbol ?? '—'}</td>
                      <td style={{ padding: '10px 14px', color: '#94a3b8', textTransform: 'capitalize' }}>{t.desk ?? '—'}</td>
                      <td style={{ padding: '10px 14px', color: sideColor, fontWeight: 'bold', textTransform: 'uppercase' }}>{t.side ?? '—'}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', color: '#94a3b8' }}>{t.qty ?? '—'}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', color: '#94a3b8' }}>{t.entry_price != null ? fmt$(Number(t.entry_price)) : '—'}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', color: '#94a3b8' }}>{t.exit_price != null ? fmt$(Number(t.exit_price)) : '—'}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', color: pnlColor, fontWeight: 'bold' }}>
                        {pnl != null ? `${pnl >= 0 ? '+' : '-'}${fmt$(pnl)}` : '—'}
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', color: statusColor, fontSize: 10, textTransform: 'capitalize' }}>{t.status ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div style={{ border: `1px solid ${BORDER}`, borderRadius: 8, overflow: 'hidden', background: 'rgba(0,10,30,0.6)' }}>
        <div style={{ padding: '12px 20px', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#a78bfa', boxShadow: '0 0 8px #a78bfa', display: 'inline-block' }} />
          <span style={{ fontSize: 11, fontWeight: 'bold', color: '#a78bfa', letterSpacing: 2, textTransform: 'uppercase' }}>Strategy Outcomes</span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
                {['Date', 'Status', 'Trades', 'P&L'].map((h, i) => (
                  <th key={h} style={{ padding: '8px 14px', textAlign: i >= 2 ? 'right' : 'left', fontSize: 9, letterSpacing: 1.5, color: '#64748b', textTransform: 'uppercase', fontWeight: 'normal' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(outcomes ?? []).length === 0 && (
                <tr><td colSpan={4} style={{ padding: '32px 14px', textAlign: 'center', color: '#64748b', fontSize: 10 }}>No strategy outcomes yet</td></tr>
              )}
              {(outcomes ?? []).slice(0, 20).map((o: any) => {
                const pnl = Number(o.total_pnl ?? 0)
                const s = String(o.status ?? '').toLowerCase()
                const statusColor = s === 'approved' ? '#00ff9f' : s === 'sufficient' ? '#fbbf24' : s === 'underperforming' ? '#ff3c6e' : '#94a3b8'
                return (
                  <tr key={o.id} style={{ borderBottom: `1px solid rgba(255,255,255,0.03)` }}>
                    <td style={{ padding: '10px 14px', color: '#94a3b8', fontSize: 10 }}>{fmtDate(String(o.created_at))}</td>
                    <td style={{ padding: '10px 14px', color: statusColor, fontWeight: 'bold', fontSize: 10 }}>{cap1(s)}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', color: '#94a3b8' }}>{Number(o.total_trades ?? 0)}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', color: pnl >= 0 ? '#00ff9f' : '#ff3c6e', fontWeight: 'bold' }}>
                      {`${pnl >= 0 ? '+' : '-'}${fmt$(pnl)}`}
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
