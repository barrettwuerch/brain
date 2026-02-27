'use client'

import { PipelineFunnel } from '@/components/pipeline-funnel'
import { usePipeline } from '@/hooks/use-pipeline'
import { useEffect, useState } from 'react'

const FONT = "-apple-system, BlinkMacSystemFont, 'Inter', sans-serif"
const MONO = "'Courier New', monospace"
const BG = '#07090f'
const CARD = '#0d1117'
const BORDER = 'rgba(255,255,255,0.06)'
const GREEN = '#00c896'
const RED = '#ff3c6e'
const YELLOW = '#f5a623'
const BLUE = '#60a5fa'
const PURPLE = '#a78bfa'
const DIM = '#6b7280'
const TEXT = '#f0f0f0'
const SUBTEXT = '#9ca3af'

const GATE_CONFIG: Record<string, { label: string; sublabel: string; color: string }> = {
  gate_0: { label: 'Freshness',  sublabel: 'Cooldown check',   color: BLUE   },
  gate_1: { label: 'Signal',     sublabel: 'Condition met',    color: GREEN  },
  gate_2: { label: 'Risk',       sublabel: 'Position sizing',  color: YELLOW },
  gate_3: { label: 'Drawdown',   sublabel: 'Circuit breaker',  color: RED    },
}

function fmtTime(iso: string) {
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return iso
  const now = Date.now()
  const diff = now - d.getTime()
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function PipelinePage() {
  const { data, error, loading } = usePipeline()
  const [gateStats, setGateStats] = useState<any>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/gate-stats', { cache: 'no-store' })
        const j = await res.json()
        if (res.ok && j.ok) setGateStats(j)
      } catch {}
    }
    load()
    const iv = setInterval(load, 30000)
    return () => clearInterval(iv)
  }, [])

  const totalBlocks = Object.values(gateStats?.gateCounts ?? {}).reduce((s: number, v) => s + Number(v), 0)

  return (
    <div style={{ background: BG, minHeight: '100vh', fontFamily: FONT, color: TEXT, paddingBottom: 40 }}>
      <style>{`
        @media (max-width: 640px) {
          .pl-gate-grid { grid-template-columns: 1fr 1fr !important; }
          .pl-two-col { grid-template-columns: 1fr !important; }
        }
        .pl-row-hover:hover { background: rgba(255,255,255,0.02) !important; }
      `}</style>

      {/* Header */}
      <div style={{ padding: '28px 24px 20px', borderBottom: `1px solid ${BORDER}` }}>
        <div style={{ fontSize: 11, color: DIM, letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6, fontFamily: MONO }}>Signal Pipeline</div>
        <div style={{ fontSize: 26, fontWeight: 700, color: TEXT, letterSpacing: -0.5 }}>Scanner → Gates → Execution</div>
        {error && <div style={{ marginTop: 10, fontSize: 12, color: RED, padding: '6px 12px', border: `1px solid ${RED}33`, borderRadius: 6 }}>{error}</div>}
      </div>

      <div style={{ padding: '0 24px' }}>

        {/* Gate blocks */}
        <div style={{ marginTop: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>Gate Blocks</span>
            <span style={{ fontSize: 11, color: DIM }}>{totalBlocks} total (24h)</span>
          </div>
          <div className="pl-gate-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
            {['gate_0', 'gate_1', 'gate_2', 'gate_3'].map(gate => {
              const cfg = GATE_CONFIG[gate]
              const count = gateStats?.gateCounts?.[gate] ?? 0
              return (
                <div key={gate} style={{ background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '16px 18px', borderTop: `2px solid ${cfg.color}` }}>
                  <div style={{ fontSize: 11, color: DIM, marginBottom: 4 }}>{cfg.sublabel}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: cfg.color, marginBottom: 8 }}>{cfg.label}</div>
                  <div style={{ fontSize: 32, fontWeight: 700, color: count > 0 ? cfg.color : 'rgba(255,255,255,0.15)' }}>{count}</div>
                  <div style={{ fontSize: 10, color: DIM, marginTop: 2 }}>blocks</div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Funnel */}
        {data?.funnel && (
          <div style={{ marginTop: 24, background: CARD, border: `1px solid ${BORDER}`, borderRadius: 12, padding: '20px 24px' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: TEXT, marginBottom: 16 }}>Funnel</div>
            <PipelineFunnel funnel={data.funnel} />
          </div>
        )}

        {/* Recent blocks */}
        {gateStats?.recent?.length > 0 && (
          <div style={{ marginTop: 24, border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: `1px solid ${BORDER}`, background: 'rgba(255,255,255,0.02)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>Recent Blocks</span>
              <span style={{ fontSize: 11, color: DIM }}>{gateStats.recent.length} events</span>
            </div>
            {gateStats.recent.slice(0, 10).map((b: any, i: number) => {
              const cfg = GATE_CONFIG[b.gate] ?? { color: DIM, label: b.gate }
              return (
                <div key={i} className="pl-row-hover" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 20px', borderBottom: `1px solid ${BORDER}`, transition: 'background 0.15s' }}>
                  <span style={{ padding: '3px 8px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: `${cfg.color}18`, color: cfg.color, minWidth: 72, textAlign: 'center' }}>{cfg.label}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, color: TEXT, minWidth: 80, fontFamily: MONO }}>{b.ticker ?? '—'}</span>
                  <span style={{ fontSize: 12, color: SUBTEXT, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.reason}</span>
                  <span style={{ fontSize: 11, color: DIM, flexShrink: 0 }}>{fmtTime(b.created_at)}</span>
                </div>
              )
            })}
          </div>
        )}

        {/* Under Review + Dead Ends */}
        <div className="pl-two-col" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 24 }}>
          <div style={{ border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: `1px solid ${BORDER}`, background: 'rgba(255,255,255,0.02)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: GREEN, boxShadow: `0 0 8px ${GREEN}` }} />
              <span style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>Under Review</span>
            </div>
            <div style={{ padding: '8px 0' }}>
              {(data?.under_review ?? []).slice(0, 6).map((f: any) => (
                <div key={f.id} style={{ padding: '10px 20px', borderBottom: `1px solid ${BORDER}` }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 20, background: `${GREEN}18`, color: GREEN }}>{f.status}</span>
                  </div>
                  <div style={{ fontSize: 12, color: SUBTEXT, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{f.description}</div>
                </div>
              ))}
              {!data?.under_review?.length && <div style={{ padding: '24px 20px', fontSize: 12, color: DIM, textAlign: 'center' }}>None under review</div>}
            </div>
          </div>

          <div style={{ border: `1px solid ${BORDER}`, borderRadius: 12, overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: `1px solid ${BORDER}`, background: 'rgba(255,255,255,0.02)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 6, height: 6, borderRadius: '50%', background: RED }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: TEXT }}>Dead Ends</span>
              </div>
              <span style={{ fontSize: 11, color: DIM }}>{data?.dead_ends?.count ?? 0} total</span>
            </div>
            <div style={{ padding: '8px 0' }}>
              {(data?.dead_ends?.last5 ?? []).map((f: any) => (
                <div key={f.id} style={{ padding: '10px 20px', borderBottom: `1px solid ${BORDER}` }}>
                  <div style={{ fontSize: 10, color: DIM, marginBottom: 4, fontFamily: MONO }}>{fmtTime(f.created_at)}</div>
                  <div style={{ fontSize: 12, color: SUBTEXT, lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>{f.description}</div>
                </div>
              ))}
              {!data?.dead_ends?.last5?.length && <div style={{ padding: '24px 20px', fontSize: 12, color: DIM, textAlign: 'center' }}>No dead ends</div>}
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
