'use client'

import { usePrices } from '@/hooks/use-prices'
import { useEffect, useMemo, useState } from 'react'

const FONT = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif"
const MONO = "'Courier New', monospace"
const BG = '#07090f'
const CARD = '#0d1117'
const BORDER = 'rgba(255,255,255,0.06)'
const CYAN = '#00f0ff'
const GREEN = '#00c896'
const RED = '#ff3c6e'
const YELLOW = '#f5a623'
const DIM = '#6b7280'
const TEXT = '#f0f0f0'
const SUBTEXT = '#9ca3af'

function fmt$(x: number, decimals = 2) {
  return `$${Math.abs(x).toLocaleString('en', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
}
function fmtDate(iso: string) {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return iso
  const now = new Date()
  const diff = now.getTime() - d.getTime()
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

export default function ScoreboardPage() {
  const { data: prices } = usePrices()
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
  const closedTrades = trades.filter(t => t.pnl != null && t.status === 'closed')
  const totalPnl = closedTrades.reduce((s, t) => s + Number(t.pnl ?? 0), 0)
  const wins = closedTrades.filter(t => Number(t.pnl ?? 0) > 0).length
  const losses = closedTrades.filter(t => Number(t.pnl ?? 0) < 0).length
  const winRate = closedTrades.length ? (wins / closedTrades.length) * 100 : 0
  const pnlColor = totalPnl >= 0 ? GREEN : RED
  const deployedPct = equity > 0 ? (deployedCapital / equity) * 100 : 0

  return (
    <div style={{ background: BG, minHeight: '100vh', fontFamily: FONT, color: TEXT, paddingBottom: 40 }}>
      <style>{`
        @media (max-width: 640px) {
          .sb-stats { grid-template-columns: 1fr 1fr !important; }
          .sb-pos-table { display: none !important; }
          .sb-pos-cards { display: flex !important; }
          .sb-trade-table { display: none !important; }
          .sb-trade-list { display: flex !important; }
          .sb-hero-val { font-size: 42px !important; }
          .sb-hero-pnl { font-size: 20px !important; }
          .sb-pad { padding: 16px !important; }
        }
        .sb-pos-cards { display: none; }
        .sb-trade-list { display: none; }
        .sb-row-hover:hover { background: rgba(255,255,255,0.03) !important; }
      `}</style>

      {/* Hero */}
      <div style={{ padding: '32px 24px 24px', borderBottom: `1px solid ${BORDER}` }} className="sb-pad">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 11, color: DIM, letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 8, fontFamily: MONO }}>Portfolio Value</div>
            <div className="sb-hero-val" style={{ fontSize: 52, fontWeight: 700, color: TEXT, letterSpacing: -2, lineHeight: 1 }}>
              {fmt$(equity, 2)}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
              <div className="sb-hero-pnl" style={{ fontSize: 24, fontWeight: 600, color: pnlColor }}>
                {totalPnl >= 0 ? '+' : '-'}{fmt$(totalPnl)}
              </div>
              {closedTrades.length > 0 && (
                <div style={{ fontSize: 13, color: pnlColor, background: `${pnlColor}18`, padding: '3px 8px', borderRadius: 20, fontWeight: 500 }}>
                  {winRate.toFixed(0)}% win rate
                </div>
              )}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 10, color: DIM, fontFamily: MONO }}>{time}</div>
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end' }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: GREEN, boxShadow: `0 0 8px ${GREEN}` }} />
              <span style={{ fontSize: 10, color: DIM, fontFamily: MONO }}>PAPER · LIVE</span>
            </div>
          </div>
        </div>

        {/* Capital bar */}
        <div style={{ marginTop: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 11, color: DIM }}>{fmt$(deployedCapital)} deployed</span>
            <span style={{ fontSize: 11, color: DIM }}>{fmt$(availableCapital)} available</span>
          </div>
          <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${Math.min(100, deployedPct)}%`, background: `linear-gradient(90deg, ${CYAN}, ${GREEN})`, borderRadius: 2, transition: 'width 0.5s' }} />
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="sb-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, borderBottom: `1px solid ${BORDER}`, background: BORDER }}>
        {[
          { label: 'Trades', value: closedTrades.length.toString(), color: TEXT },
          { label: 'Wins', value: wins.toString(), color: GREEN },
          { label: 'Losses', value: losses.toString(), color: RED },
          { label: 'Avg P&L', value: closedTrades.length ? `${totalPnl / closedTrades.length >= 0 ? '+' : ''}${fmt$(totalPnl / closedTrades.length)}` : '—', color: totalPnl >= 0 ? GREEN : RED },
        ].map(s => (
          <div key={s.label} style={{ background: CARD, padding: '16px 20px' }}>
            <div style={{ fontSize: 10, color: DIM, marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ padding: '0 24px' }} className="sb-pad">

        {/* Open Positions */}
        {positions.length > 0 && (
          <div style={{ marginTop: 28 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: YELLOW, boxShadow: `0 0 8px ${YELLOW}`, animation: 'pulse 2s infinite' }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>Open Positions</span>
              <span style={{ fontSize: 11, color: DIM, marginLeft: 4 }}>{positions.length}</span>
            </div>

            {/* Desktop table */}
            <div className="sb-pos-table" style={{ border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${BORDER}`, background: 'rgba(255,255,255,0.02)' }}>
                    {['Asset', 'Qty', 'Avg Cost', 'Market Value', 'Return', ''].map((h, i) => (
                      <th key={i} style={{ padding: '10px 16px', textAlign: i >= 3 ? 'right' : 'left', fontSize: 10, color: DIM, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p: any, i: number) => {
                    const upnl = Number(p.unrealized_pl ?? 0)
                    const pct = Number(p.unrealized_plpc ?? 0) * 100
                    const color = upnl >= 0 ? GREEN : RED
                    return (
                      <tr key={i} className="sb-row-hover" style={{ borderBottom: `1px solid ${BORDER}`, transition: 'background 0.15s' }}>
                        <td style={{ padding: '14px 16px', fontWeight: 700, color: TEXT }}>{p.symbol}</td>
                        <td style={{ padding: '14px 16px', color: SUBTEXT }}>{Number(p.qty).toFixed(4)}</td>
                        <td style={{ padding: '14px 16px', color: SUBTEXT }}>{fmt$(Number(p.avg_entry_price ?? 0))}</td>
                        <td style={{ padding: '14px 16px', textAlign: 'right', color: TEXT }}>{fmt$(Number(p.market_value ?? 0))}</td>
                        <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                          <span style={{ color, fontWeight: 600 }}>{upnl >= 0 ? '+' : ''}{fmt$(upnl)}</span>
                          <span style={{ color, fontSize: 11, marginLeft: 6 }}>({pct >= 0 ? '+' : ''}{pct.toFixed(2)}%)</span>
                        </td>
                        <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                          <div style={{ display: 'inline-block', padding: '3px 8px', borderRadius: 20, background: `${YELLOW}18`, color: YELLOW, fontSize: 10 }}>Open</div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="sb-pos-cards" style={{ flexDirection: 'column', gap: 10 }}>
              {positions.map((p: any, i: number) => {
                const upnl = Number(p.unrealized_pl ?? 0)
                const pct = Number(p.unrealized_plpc ?? 0) * 100
                const color = upnl >= 0 ? GREEN : RED
                return (
                  <div key={i} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '14px 16px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: TEXT }}>{p.symbol}</div>
                        <div style={{ fontSize: 12, color: SUBTEXT, marginTop: 2 }}>{Number(p.qty).toFixed(4)} @ {fmt$(Number(p.avg_entry_price ?? 0))}</div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color }}>{upnl >= 0 ? '+' : ''}{fmt$(upnl)}</div>
                        <div style={{ fontSize: 12, color, marginTop: 2 }}>{pct >= 0 ? '+' : ''}{pct.toFixed(2)}%</div>
                      </div>
                    </div>
                    <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ fontSize: 11, color: SUBTEXT }}>Value: {fmt$(Number(p.market_value ?? 0))}</span>
                      <span style={{ padding: '3px 8px', borderRadius: 20, background: `${YELLOW}18`, color: YELLOW, fontSize: 10 }}>Open</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Trade History */}
        <div style={{ marginTop: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>Activity</span>
            <span style={{ fontSize: 11, color: DIM }}>{trades.length} trades</span>
          </div>

          {trades.length === 0 ? (
            <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '40px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>📡</div>
              <div style={{ fontSize: 14, color: SUBTEXT }}>Scanner running — waiting for first signal</div>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="sb-trade-table" style={{ border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${BORDER}`, background: 'rgba(255,255,255,0.02)' }}>
                      {['Asset', 'Side', 'Qty', 'Entry', 'Exit', 'P&L', 'Status', 'Time'].map((h, i) => (
                        <th key={i} style={{ padding: '10px 16px', textAlign: i >= 2 ? 'right' : 'left', fontSize: 10, color: DIM, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {trades.slice(0, 50).map((t: any, i: number) => {
                      const pnl = t.pnl != null ? Number(t.pnl) : null
                      const pnlColor = pnl == null ? SUBTEXT : pnl > 0 ? GREEN : pnl < 0 ? RED : DIM
                      const isBuy = String(t.side) === 'buy'
                      const isOpen = t.status === 'open'
                      return (
                        <tr key={t.id ?? i} className="sb-row-hover" style={{ borderBottom: `1px solid ${BORDER}`, transition: 'background 0.15s' }}>
                          <td style={{ padding: '12px 16px', fontWeight: 600, color: TEXT }}>{t.symbol ?? '—'}</td>
                          <td style={{ padding: '12px 16px' }}>
                            <span style={{ padding: '3px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: isBuy ? 'rgba(0,200,150,0.12)' : 'rgba(255,60,110,0.12)', color: isBuy ? GREEN : RED }}>
                              {isBuy ? 'BUY' : 'SELL'}
                            </span>
                          </td>
                          <td style={{ padding: '12px 16px', textAlign: 'right', color: SUBTEXT, fontFamily: MONO, fontSize: 12 }}>{Number(t.qty ?? 0).toFixed(4)}</td>
                          <td style={{ padding: '12px 16px', textAlign: 'right', color: SUBTEXT, fontFamily: MONO, fontSize: 12 }}>{t.entry_price != null ? fmt$(Number(t.entry_price)) : '—'}</td>
                          <td style={{ padding: '12px 16px', textAlign: 'right', color: SUBTEXT, fontFamily: MONO, fontSize: 12 }}>{t.exit_price != null ? fmt$(Number(t.exit_price)) : '—'}</td>
                          <td style={{ padding: '12px 16px', textAlign: 'right', fontWeight: 600, color: pnlColor, fontFamily: MONO, fontSize: 12 }}>
                            {pnl != null ? `${pnl >= 0 ? '+' : ''}${fmt$(pnl)}` : '—'}
                          </td>
                          <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                            <span style={{ padding: '3px 8px', borderRadius: 20, fontSize: 10, background: isOpen ? `${YELLOW}18` : `${GREEN}18`, color: isOpen ? YELLOW : GREEN }}>
                              {isOpen ? 'Open' : 'Filled'}
                            </span>
                          </td>
                          <td style={{ padding: '12px 16px', textAlign: 'right', color: DIM, fontSize: 11 }}>{fmtDate(t.opened_at)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile list */}
              <div className="sb-trade-list" style={{ flexDirection: 'column', gap: 2 }}>
                {trades.slice(0, 30).map((t: any, i: number) => {
                  const pnl = t.pnl != null ? Number(t.pnl) : null
                  const pnlColor = pnl == null ? SUBTEXT : pnl > 0 ? GREEN : pnl < 0 ? RED : DIM
                  const isBuy = String(t.side) === 'buy'
                  const isOpen = t.status === 'open'
                  return (
                    <div key={t.id ?? i} style={{ padding: '14px 0', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 12 }}>
                      {/* Side indicator */}
                      <div style={{ width: 36, height: 36, borderRadius: 10, background: isBuy ? 'rgba(0,200,150,0.12)' : 'rgba(255,60,110,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>
                        {isBuy ? '↑' : '↓'}
                      </div>
                      {/* Info */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>{t.symbol ?? '—'}</span>
                          <span style={{ fontSize: 14, fontWeight: 600, color: pnlColor }}>
                            {pnl != null ? `${pnl >= 0 ? '+' : ''}${fmt$(pnl)}` : isOpen ? 'Open' : '—'}
                          </span>
                        </div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 3 }}>
                          <span style={{ fontSize: 12, color: SUBTEXT }}>{isBuy ? 'Buy' : 'Sell'} · {t.entry_price != null ? fmt$(Number(t.entry_price)) : '—'}</span>
                          <span style={{ fontSize: 11, color: DIM }}>{fmtDate(t.opened_at)}</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
    </div>
  )
}
