'use client'

import { usePrices } from '@/hooks/use-prices'
import { useEffect, useMemo, useState } from 'react'

const FONT = "'Inter', -apple-system, BlinkMacSystemFont, sans-serif"
const MONO = "'Courier New', monospace"
const BG = '#07090f'
const CARD = '#0d1117'
const CARD2 = '#10141e'
const BORDER = 'rgba(255,255,255,0.06)'
const CYAN = '#00f0ff'
const GREEN = '#00c896'
const RED = '#ff3c6e'
const YELLOW = '#f5a623'
const DIM = '#6b7280'
const TEXT = '#f0f0f0'
const SUBTEXT = '#9ca3af'

function fmt$(x: number, d = 2) {
  return `$${Math.abs(x).toLocaleString('en', { minimumFractionDigits: d, maximumFractionDigits: d })}`
}
function fmtDate(iso: string) {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return iso
  const diff = Date.now() - d.getTime()
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' · ' +
    d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

function TradeDetailModal({ trade, onClose }: { trade: any, onClose: () => void }) {
  const [detail, setDetail] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!trade.position_id) { setLoading(false); return }
    fetch(`/api/trade-detail?position_id=${trade.position_id}`)
      .then(r => r.json()).then(d => { setDetail(d); setLoading(false) })
      .catch(() => setLoading(false))
  }, [trade.position_id])

  const pnl = trade.pnl != null ? Number(trade.pnl) : null
  const pnlColor = pnl == null ? SUBTEXT : pnl > 0 ? GREEN : pnl < 0 ? RED : DIM
  const episodes = detail?.episodes ?? []
  const manage = episodes.filter((e: any) => e.task_type === 'manage_crypto_position')
  const lastEp = manage[manage.length - 1]
  const lessons = episodes.flatMap((e: any) => Array.isArray(e.lessons) ? e.lessons.filter((l: string) => !l.startsWith('position_id:')) : [])

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }} onClick={onClose}>
      <div style={{ background: '#0d1117', border: `1px solid ${BORDER}`, borderRadius: 16, width: '100%', maxWidth: 580, maxHeight: '90vh', overflowY: 'auto', padding: 24 }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 700, color: TEXT }}>{trade.symbol}</div>
            <div style={{ fontSize: 12, color: DIM, marginTop: 3 }}>{trade.desk?.toUpperCase()} · {fmtDate(trade.opened_at)}</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            {pnl != null && <div style={{ fontSize: 22, fontWeight: 700, color: pnlColor }}>{pnl >= 0 ? '+' : ''}{fmt$(pnl)}</div>}
            <div style={{ fontSize: 11, color: DIM, marginTop: 2 }}>{trade.exit_reason?.replace(/_/g, ' ') ?? (trade.status === 'open' ? 'still open' : 'closed')}</div>
          </div>
        </div>

        {/* Trade stats */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginBottom: 20 }}>
          {[
            { label: 'Entry', value: trade.entry_price != null ? fmt$(Number(trade.entry_price)) : '—' },
            { label: 'Exit', value: trade.exit_price != null ? fmt$(Number(trade.exit_price)) : '—' },
            { label: 'Qty', value: Number(trade.qty ?? 0).toFixed(4) },
            { label: 'Stop', value: trade.stop_level != null ? fmt$(Number(trade.stop_level)) : '—' },
            { label: 'Target', value: trade.profit_target != null ? fmt$(Number(trade.profit_target)) : '—' },
            { label: 'Status', value: trade.status ?? '—' },
          ].map(s => (
            <div key={s.label} style={{ background: CARD2, borderRadius: 8, padding: '10px 12px' }}>
              <div style={{ fontSize: 10, color: DIM, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{s.label}</div>
              <div style={{ fontSize: 13, fontWeight: 600, color: TEXT, fontFamily: MONO }}>{s.value}</div>
            </div>
          ))}
        </div>

        {loading && <div style={{ textAlign: 'center', color: DIM, padding: 20, fontSize: 13 }}>Loading bot analysis...</div>}

        {!loading && lastEp?.reflection && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: CYAN, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Bot Reflection</div>
            <div style={{ background: `${CYAN}08`, border: `1px solid ${CYAN}22`, borderRadius: 10, padding: '12px 14px', fontSize: 13, color: SUBTEXT, lineHeight: 1.6 }}>
              {lastEp.reflection}
            </div>
          </div>
        )}

        {!loading && lessons.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, color: YELLOW, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Learnings ({lessons.length})</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {lessons.slice(0, 8).map((l: string, i: number) => (
                <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <span style={{ color: YELLOW, fontSize: 12, marginTop: 1, flexShrink: 0 }}>→</span>
                  <span style={{ fontSize: 12, color: SUBTEXT, lineHeight: 1.5 }}>{l}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {!loading && manage.length > 0 && (
          <div>
            <div style={{ fontSize: 11, color: DIM, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Decision History ({manage.length} checks)</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 180, overflowY: 'auto' }}>
              {manage.map((e: any, i: number) => {
                const action = e.observation?.actual?.action ?? e.action_taken?.action ?? '—'
                const reason = e.observation?.actual?.reason ?? e.action_taken?.reason ?? ''
                const score = e.outcome_score
                return (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 10px', background: CARD2, borderRadius: 6 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: action === 'exit' ? RED : action === 'hold' ? CYAN : TEXT }}>{action}</span>
                      {reason && <span style={{ fontSize: 11, color: DIM }}>{reason.replace(/_/g, ' ')}</span>}
                    </div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      {score != null && <span style={{ fontSize: 10, color: score >= 1 ? GREEN : score >= 0.5 ? YELLOW : DIM }}>{(score * 100).toFixed(0)}%</span>}
                      <span style={{ fontSize: 10, color: DIM }}>{fmtDate(e.created_at)}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {!loading && !trade.position_id && (
          <div style={{ color: DIM, fontSize: 13, textAlign: 'center', padding: 16 }}>No bot analysis available for Alpaca-only orders</div>
        )}

        <button onClick={onClose} style={{ marginTop: 20, width: '100%', padding: '10px', borderRadius: 8, border: `1px solid ${BORDER}`, background: 'transparent', color: DIM, cursor: 'pointer', fontSize: 13 }}>Close</button>
      </div>
    </div>
  )
}

export default function ScoreboardPage() {
  const { data: prices } = usePrices()
  const [trades, setTrades] = useState<any[]>([])
  const [time, setTime] = useState('')
  const [selectedTrade, setSelectedTrade] = useState<any>(null)

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

  const STARTING_CAPITAL = 50000
  const positions = useMemo(() => Array.isArray(prices?.positions) ? prices.positions : [], [prices])
  const deployedCapital = useMemo(() =>
    positions.map((p: any) => Math.abs(Number(p.market_value ?? 0))).filter(Number.isFinite).reduce((s: number, n: number) => s + n, 0)
  , [positions])
  const unrealizedPnl = useMemo(() =>
    positions.map((p: any) => Number(p.unrealized_pl ?? 0)).filter(Number.isFinite).reduce((s: number, n: number) => s + n, 0)
  , [positions])
  const closedTrades = trades.filter(t => t.pnl != null && t.status === 'closed')
  const openTrades = trades.filter(t => t.status === 'open' || t.status === 'filled')
  const totalPnl = closedTrades.reduce((s, t) => s + Number(t.pnl ?? 0), 0)
  const equity = STARTING_CAPITAL + totalPnl + unrealizedPnl
  const availableCapital = Math.max(0, STARTING_CAPITAL - deployedCapital)
  const wins = closedTrades.filter(t => Number(t.pnl ?? 0) > 0).length
  const losses = closedTrades.filter(t => Number(t.pnl ?? 0) < 0).length
  const winRate = closedTrades.length ? (wins / closedTrades.length) * 100 : 0
  const pnlColor = totalPnl >= 0 ? GREEN : RED
  const deployedPct = equity > 0 ? (deployedCapital / equity) * 100 : 0

  const TradeRow = ({ t }: { t: any }) => {
    const pnl = t.pnl != null ? Number(t.pnl) : null
    const pnlColor = pnl == null ? SUBTEXT : pnl > 0 ? GREEN : pnl < 0 ? RED : DIM
    const isBuy = String(t.side) === 'buy'
    const isOpen = t.status === 'open' || t.status === 'filled'
    return (
      <tr className="sb-row-hover" style={{ borderBottom: `1px solid ${BORDER}`, transition: 'background 0.15s', cursor: t.position_id ? 'pointer' : 'default' }}
        onClick={() => t.position_id && setSelectedTrade(t)}>
        <td style={{ padding: '12px 16px', fontWeight: 600, color: TEXT }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {t.symbol ?? '—'}
            {t.position_id && <span style={{ fontSize: 9, color: CYAN, opacity: 0.6 }}>●</span>}
          </div>
        </td>
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
          <span style={{ padding: '3px 8px', borderRadius: 20, fontSize: 10, background: isOpen ? `${YELLOW}18` : pnl != null && pnl > 0 ? `${GREEN}18` : `${RED}18`, color: isOpen ? YELLOW : pnl != null && pnl > 0 ? GREEN : RED }}>
            {isOpen ? 'Open' : pnl != null && pnl > 0 ? 'Win' : 'Loss'}
          </span>
        </td>
        <td style={{ padding: '12px 16px', textAlign: 'right', color: DIM, fontSize: 11 }}>{fmtDate(t.opened_at)}</td>
      </tr>
    )
  }

  const TradeCard = ({ t }: { t: any }) => {
    const pnl = t.pnl != null ? Number(t.pnl) : null
    const pnlColor = pnl == null ? SUBTEXT : pnl > 0 ? GREEN : pnl < 0 ? RED : DIM
    const isBuy = String(t.side) === 'buy'
    const isOpen = t.status === 'open' || t.status === 'filled'
    return (
      <div style={{ padding: '14px 0', borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', gap: 12, cursor: t.position_id ? 'pointer' : 'default' }}
        onClick={() => t.position_id && setSelectedTrade(t)}>
        <div style={{ width: 36, height: 36, borderRadius: 10, background: isBuy ? 'rgba(0,200,150,0.12)' : 'rgba(255,60,110,0.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 }}>
          {isBuy ? '↑' : '↓'}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 14, fontWeight: 600, color: TEXT }}>{t.symbol ?? '—'}</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: pnlColor }}>{pnl != null ? `${pnl >= 0 ? '+' : ''}${fmt$(pnl)}` : isOpen ? 'Open' : '—'}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 3 }}>
            <span style={{ fontSize: 12, color: SUBTEXT }}>{isBuy ? 'Buy' : 'Sell'} · {t.entry_price != null ? fmt$(Number(t.entry_price)) : '—'}</span>
            <span style={{ fontSize: 11, color: DIM }}>{fmtDate(t.opened_at)}</span>
          </div>
        </div>
      </div>
    )
  }

  const TableHeader = () => (
    <thead>
      <tr style={{ borderBottom: `1px solid ${BORDER}`, background: 'rgba(255,255,255,0.02)' }}>
        {['Asset', 'Side', 'Qty', 'Entry', 'Exit', 'P&L', 'Result', 'Time'].map((h, i) => (
          <th key={i} style={{ padding: '10px 16px', textAlign: i >= 2 ? 'right' : 'left', fontSize: 10, color: DIM, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{h}</th>
        ))}
      </tr>
    </thead>
  )

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

      {selectedTrade && <TradeDetailModal trade={selectedTrade} onClose={() => setSelectedTrade(null)} />}

      {/* Hero */}
      <div style={{ padding: '32px 24px 24px', borderBottom: `1px solid ${BORDER}` }} className="sb-pad">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontSize: 11, color: DIM, letterSpacing: '0.15em', textTransform: 'uppercase', marginBottom: 8, fontFamily: MONO }}>Portfolio Value</div>
            <div className="sb-hero-val" style={{ fontSize: 52, fontWeight: 700, color: TEXT, letterSpacing: -2, lineHeight: 1 }}>{fmt$(equity, 2)}</div>
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

      {/* Stats */}
      <div className="sb-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, borderBottom: `1px solid ${BORDER}`, background: BORDER }}>
        {[
          { label: 'Closed Trades', value: closedTrades.length.toString(), color: TEXT },
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

        {/* Open Positions from Alpaca */}
        {positions.length > 0 && (
          <div style={{ marginTop: 28 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: YELLOW, boxShadow: `0 0 8px ${YELLOW}`, animation: 'pulse 2s infinite' }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>Open Positions</span>
              <span style={{ fontSize: 11, color: DIM }}>{positions.length}</span>
            </div>
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
                      <tr key={i} className="sb-row-hover" style={{ borderBottom: `1px solid ${BORDER}` }}>
                        <td style={{ padding: '14px 16px', fontWeight: 700, color: TEXT }}>{p.symbol}</td>
                        <td style={{ padding: '14px 16px', color: SUBTEXT }}>{Number(p.qty).toFixed(4)}</td>
                        <td style={{ padding: '14px 16px', color: SUBTEXT }}>{fmt$(Number(p.avg_entry_price ?? 0))}</td>
                        <td style={{ padding: '14px 16px', textAlign: 'right', color: TEXT }}>{fmt$(Number(p.market_value ?? 0))}</td>
                        <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                          <span style={{ color, fontWeight: 600 }}>{upnl >= 0 ? '+' : ''}{fmt$(upnl)}</span>
                          <span style={{ color, fontSize: 11, marginLeft: 6 }}>({pct >= 0 ? '+' : ''}{pct.toFixed(2)}%)</span>
                        </td>
                        <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                          <div style={{ display: 'inline-block', padding: '3px 8px', borderRadius: 20, background: `${YELLOW}18`, color: YELLOW, fontSize: 10 }}>Live</div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Open Orders (from trades feed) */}
        {openTrades.length > 0 && (
          <div style={{ marginTop: 28 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: CYAN }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>Open Orders</span>
              <span style={{ fontSize: 11, color: DIM }}>{openTrades.length}</span>
              <span style={{ fontSize: 11, color: DIM }}>· click for details</span>
            </div>
            <div className="sb-trade-table" style={{ border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <TableHeader />
                <tbody>{openTrades.map((t, i) => <TradeRow key={t.id ?? i} t={t} />)}</tbody>
              </table>
            </div>
            <div className="sb-trade-list" style={{ flexDirection: 'column' }}>
              {openTrades.map((t, i) => <TradeCard key={t.id ?? i} t={t} />)}
            </div>
          </div>
        )}

        {/* Closed Trades */}
        <div style={{ marginTop: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>Closed Trades</span>
            <span style={{ fontSize: 11, color: DIM }}>{closedTrades.length}</span>
            {closedTrades.length > 0 && <span style={{ fontSize: 11, color: DIM }}>· click for bot analysis</span>}
          </div>

          {closedTrades.length === 0 ? (
            <div style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '40px 20px', textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 10 }}>📡</div>
              <div style={{ fontSize: 14, color: SUBTEXT }}>No closed trades yet — stops and targets will close positions automatically</div>
            </div>
          ) : (
            <>
              <div className="sb-trade-table" style={{ border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <TableHeader />
                  <tbody>{closedTrades.map((t, i) => <TradeRow key={t.id ?? i} t={t} />)}</tbody>
                </table>
              </div>
              <div className="sb-trade-list" style={{ flexDirection: 'column' }}>
                {closedTrades.map((t, i) => <TradeCard key={t.id ?? i} t={t} />)}
              </div>
            </>
          )}
        </div>
      </div>
      <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.4} }`}</style>
    </div>
  )
}
